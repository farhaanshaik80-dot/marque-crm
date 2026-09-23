import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
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
} from "@workspace/api-zod";

const router: IRouter = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

type DueKind = "registration" | "insurance" | "service" | "odometer-checkin";
type Status = "green" | "amber" | "red";

function formatDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
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

function dateForOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedIfEmptyInternal(): Promise<void> {
  const existing = await db.select({ id: clientsTable.id }).from(clientsTable).limit(1);
  if (existing.length > 0) return;

  const [olivia, marcus, leila] = await db
    .insert(clientsTable)
    .values([
      {
        name: "Olivia Hart",
        phone: "+971 50 555 0148",
        tier: "Signature",
        retainerAmount: "25000",
        clientSince: "2024-10-14",
        notes: "Prefers discreet servicing and airport handovers.",
      },
      {
        name: "Marcus Bell",
        phone: "+971 55 555 0286",
        tier: "Reserve",
        retainerAmount: "15000",
        clientSince: "2025-02-06",
        notes: "Travels frequently; coordinate renewal windows in advance.",
      },
      {
        name: "Leila Nasser",
        phone: "+971 52 555 0312",
        tier: "Signature",
        retainerAmount: "22000",
        clientSince: "2025-07-22",
        notes: "Keeps a second vehicle in Abu Dhabi.",
      },
    ])
    .returning();

  await db.insert(vehiclesTable).values([
    {
      clientId: olivia.id,
      model: "Range Rover Autobiography",
      plate: "D 48192",
      registrationExpiry: dateForOffset(8),
      insuranceExpiry: dateForOffset(18),
      lastServiceDate: dateForOffset(-174),
      nextServiceDue: dateForOffset(6),
      currentOdometer: 42000,
      nextServiceDueOdometer: 45000,
    },
    {
      clientId: marcus.id,
      model: "Porsche 911 Carrera GTS",
      plate: "D 73610",
      registrationExpiry: dateForOffset(42),
      insuranceExpiry: dateForOffset(74),
      lastServiceDate: dateForOffset(-112),
      nextServiceDue: dateForOffset(21),
      currentOdometer: 28000,
      nextServiceDueOdometer: 30000,
    },
    {
      clientId: leila.id,
      model: "Mercedes-Maybach S 680",
      plate: "AD 11903",
      registrationExpiry: dateForOffset(96),
      insuranceExpiry: dateForOffset(5),
      lastServiceDate: dateForOffset(-201),
      nextServiceDue: dateForOffset(64),
      currentOdometer: 51000,
      nextServiceDueOdometer: 55000,
    },
  ]);
}

let seedPromise: Promise<void> | null = null;

function seedIfEmpty(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedIfEmptyInternal().finally(() => {
      seedPromise = null;
    });
  }
  return seedPromise;
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
) {
  const rawDueItems: Array<{ kind: DueKind; label: string; dueDate: string | null; dueOdometer?: number | null; key: string }> = [
    { kind: "registration", label: "Registration", dueDate: vehicle.registrationExpiry, dueOdometer: null, key: `registration-${vehicle.registrationExpiry}` },
    { kind: "insurance", label: "Insurance", dueDate: vehicle.insuranceExpiry, dueOdometer: null, key: `insurance-${vehicle.insuranceExpiry}` },
    { kind: "service", label: "Service due", dueDate: vehicle.nextServiceDue, dueOdometer: vehicle.nextServiceDueOdometer, key: `service-${vehicle.nextServiceDue}-${vehicle.nextServiceDueOdometer}` },
  ];
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
    const kmRemaining = item.nextDueKm - vehicle.currentOdometer;
    return { ...item, costAed: Number(item.costAed), kmRemaining, status: statusForKm(kmRemaining) };
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
    nextServiceDueOdometer: vehicle.nextServiceDueOdometer,
    odometerUpdatedAt: vehicle.odometerUpdatedAt,
    odometerLastAskedAt: vehicle.odometerLastAskedAt,
    overallStatus,
    dueItems,
    maintenanceItems,
  };
}

async function getClientSummaries() {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  const vehicles = await db.select().from(vehiclesTable);
  const [sentRows, maintenance] = await Promise.all([db
    .select({ vehicleId: remindersLogTable.vehicleId, dueKey: remindersLogTable.dueKey })
    .from(remindersLogTable)
    .where(eq(remindersLogTable.sent, true)), db.select().from(maintenanceItemsTable)]);
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
       .map((vehicle) => buildVehicleStatus(vehicle, client.name, maintenance.filter((item) => item.vehicleId === vehicle.id), sentKeys))
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

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  let lastError = "Gemini returned no content";
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"]) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
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
  await seedIfEmpty();
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
  await seedIfEmpty();
  res.json(ListClientsResponse.parse(await getClientSummaries()));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db
    .insert(clientsTable)
    .values({
      name: parsed.data.name,
      phone: parsed.data.phone,
      tier: parsed.data.tier,
      retainerAmount: String(parsed.data.retainerAmount),
      clientSince: formatDate(parsed.data.clientSince),
      notes: parsed.data.notes,
    })
    .returning();
  for (const vehicle of parsed.data.vehicles) {
    await db.insert(vehiclesTable).values({
      clientId: client.id,
      model: vehicle.model,
      plate: vehicle.plate,
      registrationExpiry: formatDate(vehicle.registrationExpiry),
      insuranceExpiry: formatDate(vehicle.insuranceExpiry),
      lastServiceDate: vehicle.lastServiceDate ? formatDate(vehicle.lastServiceDate) : formatDate(new Date()),
      nextServiceDue: formatDate(vehicle.nextServiceDue),
      currentOdometer: vehicle.currentOdometer,
      nextServiceDueOdometer: vehicle.nextServiceDueOdometer,
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

router.post("/clients/:id/vehicles", async (req, res): Promise<void> => {
  const params = CreateVehicleParams.safeParse(req.params);
  const body = CreateVehicleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      clientId: params.data.id,
      model: body.data.model,
      plate: body.data.plate,
      registrationExpiry: formatDate(body.data.registrationExpiry),
      insuranceExpiry: formatDate(body.data.insuranceExpiry),
      lastServiceDate: body.data.lastServiceDate ? formatDate(body.data.lastServiceDate) : formatDate(new Date()),
      nextServiceDue: formatDate(body.data.nextServiceDue),
      currentOdometer: body.data.currentOdometer,
      nextServiceDueOdometer: body.data.nextServiceDueOdometer,
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
  const [vehicle] = await db
    .update(vehiclesTable)
    .set({
      model: body.data.model,
      plate: body.data.plate,
      registrationExpiry: formatDate(body.data.registrationExpiry),
      insuranceExpiry: formatDate(body.data.insuranceExpiry),
      lastServiceDate: formatDate(body.data.lastServiceDate ?? new Date()),
      nextServiceDue: formatDate(body.data.nextServiceDue),
      currentOdometer: body.data.currentOdometer,
      nextServiceDueOdometer: body.data.nextServiceDueOdometer,
      ...(body.data.currentOdometer !== existing.currentOdometer ? { odometerUpdatedAt: new Date() } : {}),
    })
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();
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

router.patch("/vehicles/:id/odometer", async (req, res): Promise<void> => {
  const params = UpdateVehicleOdometerParams.safeParse(req.params);
  const body = UpdateVehicleOdometerBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [vehicle] = await db
    .update(vehiclesTable)
    .set({ currentOdometer: body.data.currentOdometer, odometerUpdatedAt: new Date() })
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();
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
  const [item] = await db.insert(maintenanceItemsTable).values({ vehicleId: vehicle.id, ...body.data, costAed: String(body.data.costAed) }).returning();
  const remaining = item.nextDueKm - vehicle.currentOdometer;
  res.status(201).json(CreateMaintenanceItemResponse.parse({ ...item, costAed: Number(item.costAed), kmRemaining: remaining, status: statusForKm(remaining) }));
});

router.patch("/maintenance-items/:id", async (req, res): Promise<void> => {
  const params = UpdateMaintenanceItemParams.safeParse(req.params);
  const body = UpdateMaintenanceItemBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [existing] = await db.select().from(maintenanceItemsTable).where(eq(maintenanceItemsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Maintenance item not found" }); return; }
  const [item] = await db.update(maintenanceItemsTable).set({ ...body.data, costAed: String(body.data.costAed) }).where(eq(maintenanceItemsTable.id, params.data.id)).returning();
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, item.vehicleId));
  const remaining = item.nextDueKm - (vehicle?.currentOdometer ?? 0);
  res.json(UpdateMaintenanceItemResponse.parse({ ...item, costAed: Number(item.costAed), kmRemaining: remaining, status: statusForKm(remaining) }));
});

router.delete("/maintenance-items/:id", async (req, res): Promise<void> => {
  const params = DeleteMaintenanceItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(maintenanceItemsTable).where(eq(maintenanceItemsTable.id, params.data.id)).returning();
  if (!item) { res.status(404).json({ error: "Maintenance item not found" }); return; }
  DeleteMaintenanceItemResponse.parse(undefined);
  res.sendStatus(204);
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
  const [reminder] = await db
    .insert(remindersLogTable)
    .values({
      clientId: parsed.data.clientId,
      vehicleId: parsed.data.vehicleId,
      dueKey: parsed.data.dueKey,
      messageText: parsed.data.messageText,
      sent: true,
      sentAt: new Date(),
    })
    .returning();
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
  if (parsed.data.dueKey.startsWith("odometer-checkin-")) {
    await db.update(vehiclesTable).set({ odometerLastAskedAt: new Date() }).where(eq(vehiclesTable.id, parsed.data.vehicleId));
  }
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