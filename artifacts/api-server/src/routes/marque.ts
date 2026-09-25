import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { clientDocumentsTable, vehicleUpdateHistoryTable } from "@workspace/db";
import {
  clientsTable,
  db,
  remindersLogTable,
  maintenanceItemsTable,
  vehiclesTable,
} from "@workspace/db";
import {
  CreateClientBody,
  CreateVehicleBody,
  CreateVehicleParams,
  DeleteClientParams,
  DeleteClientResponse,
  DeleteVehicleParams,
  DeleteVehicleResponse,
  DraftReminderBody,
  GetClientParams,
  ListRemindersParams,
  MarkReminderSentBody,
  UpdateClientBody,
  UpdateClientParams,
  UpdateVehicleBody,
  UpdateVehicleParams,
  GetDashboardResponse,
  ListClientsResponse,
  GetClientResponse,
  CreateClientResponse,
  UpdateClientResponse,
  CreateVehicleResponse,
  UpdateVehicleResponse,
  ListRemindersResponse,
  MarkReminderSentResponse,
  DraftReminderResponse,
  CreateMaintenanceItemParams, CreateMaintenanceItemBody, CreateMaintenanceItemResponse,
  UpdateMaintenanceItemParams, UpdateMaintenanceItemBody, UpdateMaintenanceItemResponse,
  DeleteMaintenanceItemParams, DeleteMaintenanceItemResponse,
  UpdateVehicleOdometerParams, UpdateVehicleOdometerBody, UpdateVehicleOdometerResponse,
  ExtractDocumentBody, ExtractDocumentResponse, ListClientDocumentsParams, ListClientDocumentsResponse,
  CreateClientDocumentParams, CreateClientDocumentBody, CreateClientDocumentResponse,
  UpdateVehicleMulkiyaParams, UpdateVehicleMulkiyaBody, UpdateVehicleMulkiyaResponse,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const objectStorageService = new ObjectStorageService();

type DueKind = "registration" | "insurance" | "service" | "odometer-checkin";
type Status = "green" | "amber" | "red";

function formatDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function validationErrorMessage(error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> }): string {
  const issue = error.issues[0];
  const field = String(issue?.path.at(-1) ?? "request");
  const labels: Record<string, string> = {
    name: "Client name",
    phone: "Phone number",
    tier: "Tier",
    retainerAmount: "Retainer amount",
    clientSince: "Client since date",
    model: "Vehicle make/model",
    plate: "Plate",
    registrationExpiry: "Registration expiry",
    insuranceExpiry: "Insurance expiry",
    lastServiceDate: "Last service date",
    nextServiceDue: "Next service due date",
    currentOdometer: "Current odometer",
    serviceIntervalKm: "Service interval",
    nextServiceDueOdometer: "Service interval",
  };
  const label = labels[field] ?? field;
  if (field === "phone") return "Phone number format invalid. Use digits and optional spaces, brackets, hyphens, or a leading +.";
  if (issue?.code === "invalid_type") return `${label} is invalid.`;
  if (issue?.code === "too_small") return `${label} is too short or below the allowed minimum.`;
  if (issue?.code === "too_big") return `${label} exceeds the allowed maximum.`;
  return `${label}: ${issue?.message ?? "invalid value"}`;
}

function daysUntil(dateValue: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const due = new Date(`${dateValue}T00:00:00Z`).getTime();
  return Math.round((due - todayUtc) / DAY_MS);
}

function statusForDays(days: number): "green" | "amber" | "red" {
  if (days < 0 || days <= 7) return "red";
  if (days <= 30) return "amber";
  return "green";
}
function statusForKm(km: number): Status {
  if (km <= 0) return "red";
  if (km <= 1000) return "amber";
  return "green";
}
function worse(a: Status, b: Status): Status {
  return a === "red" || b === "red" ? "red" : a === "amber" || b === "amber" ? "amber" : "green";
}

async function getReminderRows(clientId?: number) {
  const query = db
    .select({
      id: remindersLogTable.id,
      clientId: remindersLogTable.clientId,
      vehicleId: remindersLogTable.vehicleId,
      dueKey: remindersLogTable.dueKey,
      messageText: remindersLogTable.messageText,
      draftedAt: remindersLogTable.draftedAt,
      sent: remindersLogTable.sent,
      sentAt: remindersLogTable.sentAt,
      vehicleModel: vehiclesTable.model,
    })
    .from(remindersLogTable)
    .leftJoin(vehiclesTable, eq(remindersLogTable.vehicleId, vehiclesTable.id))
    .orderBy(desc(remindersLogTable.draftedAt));

  if (clientId === undefined) return query;
  return query.where(eq(remindersLogTable.clientId, clientId));
}

function buildVehicleStatus(
  vehicle: typeof vehiclesTable.$inferSelect,
  clientName: string,
  maintenance: Array<typeof maintenanceItemsTable.$inferSelect>,
  sentKeys: Set<string>,
  history: Array<typeof vehicleUpdateHistoryTable.$inferSelect> = [],
) {
  const rawDueItems: Array<{ kind: DueKind; label: string; dueDate: string | null; dueOdometer?: number | null; key: string }> = [];
  if (vehicle.registrationExpiry) rawDueItems.push({ kind: "registration", label: "Registration", dueDate: vehicle.registrationExpiry, dueOdometer: null, key: `registration-${vehicle.registrationExpiry}` });
  if (vehicle.insuranceExpiry) rawDueItems.push({ kind: "insurance", label: "Insurance", dueDate: vehicle.insuranceExpiry, dueOdometer: null, key: `insurance-${vehicle.insuranceExpiry}` });
  if (vehicle.nextServiceDue || vehicle.serviceIntervalKm > 0) {
    rawDueItems.push({
      kind: "service",
      label: "Service due",
      dueDate: vehicle.nextServiceDue,
      dueOdometer: vehicle.serviceIntervalKm > 0 ? vehicle.nextServiceDueOdometer : null,
      key: `service-${vehicle.nextServiceDue ?? "no-date"}-${vehicle.nextServiceDueOdometer}`,
    });
  }
  const anchor = Math.max(vehicle.odometerUpdatedAt.getTime(), vehicle.odometerLastAskedAt?.getTime() ?? 0);
  if (Date.now() - anchor >= 15 * DAY_MS) rawDueItems.push({ kind: "odometer-checkin", label: `Ask ${clientName} for their current km`, dueDate: null, dueOdometer: null, key: `odometer-checkin-${new Date(anchor).toISOString().slice(0, 10)}` });
  const dueItems = rawDueItems
    .map((item) => {
      const days = item.dueDate ? daysUntil(item.dueDate) : null;
      const km = item.dueOdometer == null ? null : item.dueOdometer - vehicle.currentOdometer;
      const dateStatus = days == null ? "green" : statusForDays(days);
      const mileageStatus = km == null ? "green" : statusForKm(km);
      return {
        ...item,
        daysUntilDue: days,
        dueDate: item.dueDate,
        kmUntilDue: km,
        status: item.kind === "odometer-checkin" ? "amber" : worse(dateStatus, mileageStatus),
        reminderSent: sentKeys.has(`${vehicle.id}:${item.key}`),
      };
    })
    .filter((item) => !item.reminderSent);
  const maintenanceItems = maintenance.map((item) => {
    const kmRemaining = item.nextDueKm == null ? null : item.nextDueKm - vehicle.currentOdometer;
    return {
      ...item,
      costAed: Number(item.costAed),
      kmRemaining,
      status: kmRemaining == null || item.itemType === "payment" ? "green" : statusForKm(kmRemaining),
    };
  });

  const overallStatus = [...dueItems, ...maintenanceItems].reduce<"green" | "amber" | "red">(
    (current, item) => worse(current, item.status),
    "green",
  );

  return {
    id: vehicle.id,
    clientId: vehicle.clientId,
    model: vehicle.model,
    plate: vehicle.plate,
    registrationExpiry: vehicle.registrationExpiry,
    insuranceExpiry: vehicle.insuranceExpiry,
    lastServiceDate: vehicle.lastServiceDate,
    nextServiceDue: vehicle.nextServiceDue,
    currentOdometer: vehicle.currentOdometer,
    serviceIntervalKm: vehicle.serviceIntervalKm,
    nextServiceDueOdometer: vehicle.nextServiceDueOdometer,
    odometerUpdatedAt: vehicle.odometerUpdatedAt,
    odometerLastAskedAt: vehicle.odometerLastAskedAt,
    mulkiyaImagePath: vehicle.mulkiyaImagePath,
    overallStatus,
    dueItems,
    maintenanceItems,
    updateHistory: history,
  };
}

async function getClientSummaries() {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  const vehicles = await db.select().from(vehiclesTable);
  const [sentRows, maintenance, history] = await Promise.all([db
    .select({ vehicleId: remindersLogTable.vehicleId, dueKey: remindersLogTable.dueKey })
    .from(remindersLogTable)
    .where(eq(remindersLogTable.sent, true)), db.select().from(maintenanceItemsTable), db.select().from(vehicleUpdateHistoryTable).orderBy(desc(vehicleUpdateHistoryTable.changedAt))]);
  const sentKeys = new Set(sentRows.map((row) => `${row.vehicleId}:${row.dueKey}`));

  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    phone: client.phone,
    tier: client.tier,
    retainerAmount: Number(client.retainerAmount),
    clientSince: client.clientSince,
    notes: client.notes,
    vehicles: vehicles
      .filter((vehicle) => vehicle.clientId === client.id)
       .map((vehicle) => buildVehicleStatus(vehicle, client.name, maintenance.filter((item) => item.vehicleId === vehicle.id), sentKeys, history.filter((item) => item.vehicleId === vehicle.id).slice(0, 20)))
      .sort((a, b) => {
         const aSoonest = Math.min(...a.dueItems.map((item) => item.daysUntilDue ?? 9999), 9999);
         const bSoonest = Math.min(...b.dueItems.map((item) => item.daysUntilDue ?? 9999), 9999);
        return aSoonest - bSoonest;
      }),
  }));
}

async function getClientDetail(id: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) return undefined;
  const summaries = await getClientSummaries();
  const summary = summaries.find((item) => item.id === id);
  const reminders = await getReminderRows(id);
  return {
    ...summary,
    reminders,
  };
}

const FAST_MODEL_ORDER = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
// For reading messy/handwritten photos, accuracy matters more than speed, so try the stronger models first.
const ACCURATE_MODEL_ORDER = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];

async function callGemini(
  prompt: string,
  image?: { mimeType: string; base64Data: string },
  modelOrder: string[] = FAST_MODEL_ORDER,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (image) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64Data } });
  }

  let lastError = "Gemini returned no content";
  for (const model of modelOrder) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    const responseText = await response.text();
    if (!response.ok) {
      lastError = `Gemini ${model} failed with status ${response.status}: ${responseText.slice(0, 240)}`;
      if (![404, 429, 500, 502, 503].includes(response.status)) break;
      continue;
    }
    const payload = JSON.parse(responseText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (text) return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    lastError = `Gemini ${model} returned no content`;
  }
  throw new Error(lastError);
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const clients = await getClientSummaries();
  const reminders = await getReminderRows();
  const dueSoonCount = clients.reduce(
    (total, client) => total + client.vehicles.reduce((count, vehicle) => count + vehicle.dueItems.filter((item) => item.status !== "green").length, 0),
    0,
  );
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const sentThisMonth = reminders.filter((reminder) => reminder.sent && reminder.sentAt && new Date(reminder.sentAt) >= monthStart).length;
  res.json(
    GetDashboardResponse.parse({
      clients,
      totalClients: clients.length,
      totalVehicles: clients.reduce((total, client) => total + client.vehicles.length, 0),
      dueSoonCount,
      sentThisMonth,
    }),
  );
});

router.get("/clients", async (_req, res): Promise<void> => {
  res.json(ListClientsResponse.parse(await getClientSummaries()));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationErrorMessage(parsed.error) });
    return;
  }
  const today = formatDate(new Date());
  const [client] = await db
    .insert(clientsTable)
    .values({
      name: parsed.data.name.trim(),
      phone: parsed.data.phone.trim(),
      tier: parsed.data.tier?.trim() || "Signature",
      retainerAmount: String(parsed.data.retainerAmount ?? 0),
      clientSince: parsed.data.clientSince ? formatDate(parsed.data.clientSince) : today,
      notes: parsed.data.notes?.trim() ?? "",
    })
    .returning();
  for (const vehicle of parsed.data.vehicles ?? []) {
    const currentOdometer = vehicle.currentOdometer ?? 0;
    const serviceIntervalKm = vehicle.serviceIntervalKm ?? vehicle.nextServiceDueOdometer ?? 0;
    await db.insert(vehiclesTable).values({
      clientId: client.id,
      model: vehicle.model?.trim() ?? "",
      plate: vehicle.plate?.trim() ?? "",
      registrationExpiry: vehicle.registrationExpiry ? formatDate(vehicle.registrationExpiry) : null,
      insuranceExpiry: vehicle.insuranceExpiry ? formatDate(vehicle.insuranceExpiry) : null,
      lastServiceDate: vehicle.lastServiceDate ? formatDate(vehicle.lastServiceDate) : null,
      nextServiceDue: vehicle.nextServiceDue ? formatDate(vehicle.nextServiceDue) : null,
      currentOdometer,
      serviceIntervalKm,
      nextServiceDueOdometer: serviceIntervalKm > 0 ? currentOdometer + serviceIntervalKm : 0,
    });
  }
  res.status(201).json(CreateClientResponse.parse(await getClientDetail(client.id)));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await getClientDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(GetClientResponse.parse(detail));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  const body = UpdateClientBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set({
      name: body.data.name,
      phone: body.data.phone,
      tier: body.data.tier,
      retainerAmount: String(body.data.retainerAmount),
      clientSince: formatDate(body.data.clientSince),
      notes: body.data.notes,
    })
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(UpdateClientResponse.parse(await getClientDetail(client.id)));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [client] = await db.delete(clientsTable).where(eq(clientsTable.id, params.data.id)).returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  DeleteClientResponse.parse(undefined);
  res.sendStatus(204);
});

router.post("/clients/:id/vehicles", async (req, res): Promise<void> => {
  const params = CreateVehicleParams.safeParse(req.params);
  const body = CreateVehicleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: validationErrorMessage(body.error) });
    return;
  }
  const currentOdometer = body.data.currentOdometer ?? 0;
  const serviceIntervalKm = body.data.serviceIntervalKm ?? body.data.nextServiceDueOdometer ?? 0;
  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      clientId: params.data.id,
      model: body.data.model?.trim() ?? "",
      plate: body.data.plate?.trim() ?? "",
      registrationExpiry: body.data.registrationExpiry ? formatDate(body.data.registrationExpiry) : null,
      insuranceExpiry: body.data.insuranceExpiry ? formatDate(body.data.insuranceExpiry) : null,
      lastServiceDate: body.data.lastServiceDate ? formatDate(body.data.lastServiceDate) : null,
      nextServiceDue: body.data.nextServiceDue ? formatDate(body.data.nextServiceDue) : null,
      currentOdometer,
      serviceIntervalKm,
      nextServiceDueOdometer: serviceIntervalKm > 0 ? currentOdometer + serviceIntervalKm : 0,
    })
    .returning();
  const client = await db.select().from(clientsTable).where(eq(clientsTable.id, vehicle.clientId));
  res.status(201).json(CreateVehicleResponse.parse(buildVehicleStatus(vehicle, client[0]?.name ?? "", [], new Set())));
});

router.patch("/vehicles/:id", async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  const body = UpdateVehicleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  const [vehicle] = await db.transaction(async (tx) => {
    const nextCurrentOdometer = body.data.currentOdometer ?? existing.currentOdometer;
    const nextServiceIntervalKm = body.data.serviceIntervalKm ?? body.data.nextServiceDueOdometer ?? existing.serviceIntervalKm;
    const nextRegistrationExpiry = body.data.registrationExpiry ? formatDate(body.data.registrationExpiry) : existing.registrationExpiry;
    const nextInsuranceExpiry = body.data.insuranceExpiry ? formatDate(body.data.insuranceExpiry) : existing.insuranceExpiry;
    const nextServiceDue = body.data.nextServiceDue ? formatDate(body.data.nextServiceDue) : existing.nextServiceDue;
    const candidates: Array<[string, string | number | null, string | number | null]> = [
      ["current_odometer_km", existing.currentOdometer, nextCurrentOdometer],
      ["registration_expiry", existing.registrationExpiry, nextRegistrationExpiry],
      ["insurance_expiry", existing.insuranceExpiry, nextInsuranceExpiry],
      ["next_service_due", existing.nextServiceDue, nextServiceDue],
    ];
    const changed = candidates.filter(([, oldValue, newValue]) => oldValue !== newValue);
    const [updated] = await tx.update(vehiclesTable).set({
      model: body.data.model ?? existing.model,
      plate: body.data.plate ?? existing.plate,
      registrationExpiry: nextRegistrationExpiry,
      insuranceExpiry: nextInsuranceExpiry,
      lastServiceDate: body.data.lastServiceDate ? formatDate(body.data.lastServiceDate) : existing.lastServiceDate,
      nextServiceDue,
      currentOdometer: nextCurrentOdometer,
      serviceIntervalKm: nextServiceIntervalKm,
      nextServiceDueOdometer: nextServiceIntervalKm > 0 ? nextCurrentOdometer + nextServiceIntervalKm : 0,
      ...(nextCurrentOdometer !== existing.currentOdometer ? { odometerUpdatedAt: new Date() } : {}),
    }).where(eq(vehiclesTable.id, params.data.id)).returning();
    if (changed.length) await tx.insert(vehicleUpdateHistoryTable).values(changed.map(([fieldChanged, oldValue, newValue]) => ({ vehicleId: existing.id, fieldChanged, oldValue: String(oldValue), newValue: String(newValue) })));
    return [updated];
  });
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  const sentRows = await db
    .select({ dueKey: remindersLogTable.dueKey })
    .from(remindersLogTable)
    .where(and(eq(remindersLogTable.vehicleId, vehicle.id), eq(remindersLogTable.sent, true)));
  const client = await db.select().from(clientsTable).where(eq(clientsTable.id, vehicle.clientId));
  const items = await db.select().from(maintenanceItemsTable).where(eq(maintenanceItemsTable.vehicleId, vehicle.id));
  res.json(UpdateVehicleResponse.parse(buildVehicleStatus(vehicle, client[0]?.name ?? "", items, new Set(sentRows.map((row) => `${vehicle.id}:${row.dueKey}`)))));
});

router.delete("/vehicles/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [vehicle] = await db.delete(vehiclesTable).where(eq(vehiclesTable.id, params.data.id)).returning();
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  DeleteVehicleResponse.parse(undefined);
  res.sendStatus(204);
});

router.patch("/vehicles/:id/odometer", async (req, res): Promise<void> => {
  const params = UpdateVehicleOdometerParams.safeParse(req.params);
  const body = UpdateVehicleOdometerBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [vehicle] = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
    if (!current) return [];
    const nextServiceDueOdometer = current.serviceIntervalKm > 0 ? body.data.currentOdometer + current.serviceIntervalKm : 0;
    const [updated] = await tx.update(vehiclesTable).set({ currentOdometer: body.data.currentOdometer, nextServiceDueOdometer, odometerUpdatedAt: new Date() }).where(eq(vehiclesTable.id, params.data.id)).returning();
    await tx.insert(vehicleUpdateHistoryTable).values({ vehicleId: current.id, fieldChanged: "current_odometer_km", oldValue: String(current.currentOdometer), newValue: String(body.data.currentOdometer) });
    return [updated];
  });
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const [[client], items, sentRows] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.id, vehicle.clientId)),
    db.select().from(maintenanceItemsTable).where(eq(maintenanceItemsTable.vehicleId, vehicle.id)),
    db.select({ dueKey: remindersLogTable.dueKey }).from(remindersLogTable).where(and(eq(remindersLogTable.vehicleId, vehicle.id), eq(remindersLogTable.sent, true))),
  ]);
  res.json(UpdateVehicleOdometerResponse.parse(buildVehicleStatus(vehicle, client?.name ?? "", items, new Set(sentRows.map((row) => `${vehicle.id}:${row.dueKey}`)))));
});

router.post("/vehicles/:id/maintenance-items", async (req, res): Promise<void> => {
  const params = CreateMaintenanceItemParams.safeParse(req.params);
  const body = CreateMaintenanceItemBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  if (body.data.photoObjectPath && !req.isAuthenticated()) { res.status(401).json({ error: "Login is required to attach a photo" }); return; }
  try {
    const itemType = body.data.itemType;
    const currentKm = itemType === "maintenance" ? body.data.currentKm ?? null : null;
    const interval = itemType === "maintenance" ? body.data.changeIntervalKm ?? null : null;
    const nextDueKm = currentKm != null && interval != null ? currentKm + interval : null;
    const photoObjectPath = body.data.photoObjectPath
      ? await objectStorageService.trySetObjectEntityAclPolicy(body.data.photoObjectPath, { owner: req.user!.id, visibility: "private" })
      : null;
    const [item] = await db.insert(maintenanceItemsTable).values({
      vehicleId: vehicle.id,
      itemType,
      name: body.data.name,
      costAed: String(body.data.costAed),
      currentKm,
      changeIntervalKm: interval,
      nextDueKm,
      dateRecorded: formatDate(new Date()),
      photoObjectPath,
      photoOriginalFileName: body.data.photoOriginalFileName ?? null,
      photoContentType: body.data.photoContentType ?? null,
    }).returning();
    const remaining = item.nextDueKm == null ? null : item.nextDueKm - vehicle.currentOdometer;
    res.status(201).json(CreateMaintenanceItemResponse.parse({ ...item, costAed: Number(item.costAed), kmRemaining: remaining, status: remaining == null ? "green" : statusForKm(remaining) }));
  } catch (error) {
    req.log.error({ err: error }, "Maintenance item save failed");
    res.status(400).json({ error: "Maintenance item photo could not be secured" });
  }
});

router.patch("/maintenance-items/:id", async (req, res): Promise<void> => {
  const params = UpdateMaintenanceItemParams.safeParse(req.params);
  const body = UpdateMaintenanceItemBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [existing] = await db.select().from(maintenanceItemsTable).where(eq(maintenanceItemsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Maintenance item not found" }); return; }
  if (body.data.photoObjectPath && !req.isAuthenticated()) { res.status(401).json({ error: "Login is required to attach a photo" }); return; }
  try {
    const itemType = body.data.itemType;
    const currentKm = itemType === "maintenance" ? body.data.currentKm ?? null : null;
    const interval = itemType === "maintenance" ? body.data.changeIntervalKm ?? null : null;
    const nextDueKm = currentKm != null && interval != null ? currentKm + interval : null;
    const photoObjectPath = body.data.photoObjectPath
      ? await objectStorageService.trySetObjectEntityAclPolicy(body.data.photoObjectPath, { owner: req.user!.id, visibility: "private" })
      : existing.photoObjectPath;
    const [item] = await db.update(maintenanceItemsTable).set({
      itemType,
      name: body.data.name,
      costAed: String(body.data.costAed),
      currentKm,
      changeIntervalKm: interval,
      nextDueKm,
      dateRecorded: formatDate(new Date()),
      photoObjectPath,
      photoOriginalFileName: body.data.photoOriginalFileName ?? existing.photoOriginalFileName,
      photoContentType: body.data.photoContentType ?? existing.photoContentType,
    }).where(eq(maintenanceItemsTable.id, params.data.id)).returning();
    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, item.vehicleId));
    const remaining = item.nextDueKm == null ? null : item.nextDueKm - (vehicle?.currentOdometer ?? 0);
    res.json(UpdateMaintenanceItemResponse.parse({ ...item, costAed: Number(item.costAed), kmRemaining: remaining, status: remaining == null ? "green" : statusForKm(remaining) }));
  } catch (error) {
    req.log.error({ err: error }, "Maintenance item update failed");
    res.status(400).json({ error: "Maintenance item photo could not be secured" });
  }
});

router.delete("/maintenance-items/:id", async (req, res): Promise<void> => {
  const params = DeleteMaintenanceItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(maintenanceItemsTable).where(eq(maintenanceItemsTable.id, params.data.id)).returning();
  if (!item) { res.status(404).json({ error: "Maintenance item not found" }); return; }
  DeleteMaintenanceItemResponse.parse(undefined);
  res.sendStatus(204);
});

router.post("/documents/extract", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ExtractDocumentBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.objectPath.startsWith("/objects/")) { res.status(400).json({ error: "A valid image object path is required" }); return; }
  try {
    const bytes = await objectStorageService.downloadObjectBytes(parsed.data.objectPath);
    const prompt = `You are reading a photo of a bill, receipt, or invoice — it may be handwritten, faded, creased, or otherwise hard to read. Look carefully, line by line, at every row, abbreviation, or shorthand entry (e.g. "Fr. B/pad", "Belt Ex", "Ac Com" are three SEPARATE items: front brake pad, belt exchange, AC component/compressor). Count how many distinct billable items are listed — most bills with more than one line have 2 or more. Each distinct part or service is its own entry; never combine multiple items into one description, even if their amounts are unclear or written close together. Return ONLY a JSON array, one entry per distinct item, with exactly these fields: documentType (one of service_bill, part_bill, parking_receipt — pick the closest fit; a warranty card for a part should be documentType "part_bill"), date (YYYY-MM-DD or null, same for every item on this bill), amountAed (number or null — that specific item's price if shown separately, otherwise null; do not split a single total across items unless individual prices are visible), vendorName (string, same for every item on this bill), description (string naming just that one item, expanded from any abbreviation, e.g. "Front brake pad" not "Fr. B/pad"), warrantyExpiry (YYYY-MM-DD or null, only if this item includes warranty coverage). Do not infer values that are not visible. Only return a single-entry array if the bill genuinely lists just one item.`;
    const text = await callGemini(prompt, { mimeType: parsed.data.contentType, base64Data: bytes.toString("base64") }, ACCURATE_MODEL_ORDER);
    const parsedJson = JSON.parse(text);
    const items = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
    res.json(ExtractDocumentResponse.parse(items));
  } catch (error) {
    req.log.error({ err: error }, "Document extraction failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(502).json({ error: `Gemini could not extract this document. ${message}` });
  }
});

router.get("/clients/:id/documents", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListClientDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  const rows = await db.select().from(clientDocumentsTable).where(eq(clientDocumentsTable.clientId, client.id)).orderBy(desc(clientDocumentsTable.createdAt));
  res.json(ListClientDocumentsResponse.parse(rows.map((row) => ({ ...row, date: row.documentDate, amountAed: Number(row.amountAed) }))));
});

router.post("/clients/:id/documents", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreateClientDocumentParams.safeParse(req.params);
  const body = CreateClientDocumentBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!body.data.objectPath.startsWith("/objects/")) { res.status(400).json({ error: "A valid object path is required" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  if (body.data.vehicleId != null) {
    const [vehicle] = await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, body.data.vehicleId), eq(vehiclesTable.clientId, client.id)));
    if (!vehicle) { res.status(400).json({ error: "Vehicle does not belong to client" }); return; }
  }
  try {
    const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(body.data.objectPath, { owner: req.user.id, visibility: "private" });
    const [row] = await db.insert(clientDocumentsTable).values({ clientId: client.id, vehicleId: body.data.vehicleId ?? null, documentType: body.data.documentType, documentDate: formatDate(body.data.date), amountAed: String(body.data.amountAed), vendorName: body.data.vendorName, description: body.data.description, warrantyExpiry: body.data.warrantyExpiry ? formatDate(body.data.warrantyExpiry) : null, objectPath, originalFileName: body.data.originalFileName, contentType: body.data.contentType }).returning();
    // A part or service bill logged against a specific vehicle also shows up as a cost entry
    // in that vehicle's Flexible Maintenance list, so it doesn't only live in Documents.
    if (body.data.vehicleId != null && (body.data.documentType === "part_bill" || body.data.documentType === "service_bill")) {
      await db.insert(maintenanceItemsTable).values({
        vehicleId: body.data.vehicleId,
        itemType: "payment",
        name: body.data.description || body.data.vendorName,
        costAed: String(body.data.amountAed),
        dateRecorded: formatDate(body.data.date),
      });
    }
    res.status(201).json(CreateClientDocumentResponse.parse({ ...row, date: row.documentDate, amountAed: Number(row.amountAed) }));
  } catch (error) { req.log.error({ err: error }, "Document save failed"); res.status(400).json({ error: "Object could not be secured" }); }
});

router.patch("/vehicles/:id/mulkiya", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateVehicleMulkiyaParams.safeParse(req.params);
  const body = UpdateVehicleMulkiyaBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!body.data.objectPath.startsWith("/objects/")) { res.status(400).json({ error: "A valid object path is required" }); return; }
  const [existing] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Vehicle not found" }); return; }
  try {
    const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(body.data.objectPath, { owner: req.user.id, visibility: "private" });
    const [vehicle] = await db.update(vehiclesTable).set({ mulkiyaImagePath: objectPath }).where(eq(vehiclesTable.id, existing.id)).returning();
    const [[client], items, sentRows, history] = await Promise.all([db.select().from(clientsTable).where(eq(clientsTable.id, vehicle.clientId)), db.select().from(maintenanceItemsTable).where(eq(maintenanceItemsTable.vehicleId, vehicle.id)), db.select({ dueKey: remindersLogTable.dueKey }).from(remindersLogTable).where(and(eq(remindersLogTable.vehicleId, vehicle.id), eq(remindersLogTable.sent, true))), db.select().from(vehicleUpdateHistoryTable).where(eq(vehicleUpdateHistoryTable.vehicleId, vehicle.id)).orderBy(desc(vehicleUpdateHistoryTable.changedAt))]);
    res.json(UpdateVehicleMulkiyaResponse.parse(buildVehicleStatus(vehicle, client?.name ?? "", items, new Set(sentRows.map((r) => `${vehicle.id}:${r.dueKey}`)), history.slice(0, 20))));
  } catch (error) { req.log.error({ err: error }, "Mulkiya save failed"); res.status(400).json({ error: "Object could not be secured" }); }
});

router.get("/clients/:id/reminders", async (req, res): Promise<void> => {
  const params = ListRemindersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  res.json(ListRemindersResponse.parse(await getReminderRows(params.data.id)));
});

router.post("/reminders", async (req, res): Promise<void> => {
  const parsed = MarkReminderSentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reminder] = await db.transaction(async (tx) => {
    const [saved] = await tx.insert(remindersLogTable).values({
        clientId: parsed.data.clientId,
        vehicleId: parsed.data.vehicleId,
        dueKey: parsed.data.dueKey,
        messageText: parsed.data.messageText,
        sent: true,
        sentAt: new Date(),
      }).returning();
    await tx.insert(vehicleUpdateHistoryTable).values({
      vehicleId: parsed.data.vehicleId,
      fieldChanged: "reminder_sent",
      oldValue: parsed.data.dueKey,
      newValue: parsed.data.messageText,
    });
    if (parsed.data.dueKey.startsWith("odometer-checkin-")) {
      await tx.update(vehiclesTable).set({ odometerLastAskedAt: new Date() }).where(eq(vehiclesTable.id, parsed.data.vehicleId));
    }
    return [saved];
  });
  const [withVehicle] = await db
    .select({
      id: remindersLogTable.id,
      clientId: remindersLogTable.clientId,
      vehicleId: remindersLogTable.vehicleId,
      dueKey: remindersLogTable.dueKey,
      messageText: remindersLogTable.messageText,
      draftedAt: remindersLogTable.draftedAt,
      sent: remindersLogTable.sent,
      sentAt: remindersLogTable.sentAt,
      vehicleModel: vehiclesTable.model,
    })
    .from(remindersLogTable)
    .leftJoin(vehiclesTable, eq(remindersLogTable.vehicleId, vehiclesTable.id))
    .where(eq(remindersLogTable.id, reminder.id));
  res.status(201).json(MarkReminderSentResponse.parse(withVehicle));
});

router.post("/ai/draft-reminder", async (req, res): Promise<void> => {
  const parsed = DraftReminderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const prompt = parsed.data.reminderType === "odometer-checkin"
      ? `Write one short, friendly WhatsApp-style message from a luxury car concierge asking the client for a quick photo of their odometer and current kilometres. Return only valid JSON with exactly this shape: {"message":""}. Do not use emojis. Client: ${parsed.data.clientName}. Car: ${parsed.data.model}, plate ${parsed.data.plate}.`
      : `Write one short, friendly WhatsApp-style message from a luxury car concierge. Return only valid JSON with exactly this shape: {"message":""}. Address the client by name, mention their car model, and clearly mention the ${parsed.data.dueLabel.toLowerCase()} date of ${formatDate(parsed.data.dueDate!)}. It is ${parsed.data.daysUntilDue! < 0 ? `${Math.abs(parsed.data.daysUntilDue!)} days overdue` : `due in ${parsed.data.daysUntilDue!} days`}. Do not use emojis. Client: ${parsed.data.clientName}. Car: ${parsed.data.model}, plate ${parsed.data.plate}.`;
    const result = await callGemini(prompt);
    res.json(DraftReminderResponse.parse(JSON.parse(result)));
  } catch (error) {
    req.log.error({ err: error }, "Gemini reminder drafting failed");
    res.status(502).json({ error: "Gemini could not draft this reminder. Check the Gemini API key and try again." });
  }
});

export default router;
