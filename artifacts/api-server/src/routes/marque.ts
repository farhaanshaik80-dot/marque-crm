import { Router, type IRouter } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  clientsTable,
  db,
  remindersLogTable,
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
} from "@workspace/api-zod";

const router: IRouter = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

type DueKind = "registration" | "insurance" | "service";

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
    },
    {
      clientId: marcus.id,
      model: "Porsche 911 Carrera GTS",
      plate: "D 73610",
      registrationExpiry: dateForOffset(42),
      insuranceExpiry: dateForOffset(74),
      lastServiceDate: dateForOffset(-112),
      nextServiceDue: dateForOffset(21),
    },
    {
      clientId: leila.id,
      model: "Mercedes-Maybach S 680",
      plate: "AD 11903",
      registrationExpiry: dateForOffset(96),
      insuranceExpiry: dateForOffset(5),
      lastServiceDate: dateForOffset(-201),
      nextServiceDue: dateForOffset(64),
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
  sentVehicleIds: Set<number>,
) {
  const reminderSent = sentVehicleIds.has(vehicle.id);
  const rawDueItems: Array<{ kind: DueKind; label: string; dueDate: string }> = [
    { kind: "registration", label: "Registration", dueDate: vehicle.registrationExpiry },
    { kind: "insurance", label: "Insurance", dueDate: vehicle.insuranceExpiry },
    { kind: "service", label: "Service due", dueDate: vehicle.nextServiceDue },
  ];
  const dueItems = rawDueItems
    .map((item) => {
      const days = daysUntil(item.dueDate);
      return {
        ...item,
        daysUntilDue: days,
        status: statusForDays(days),
        reminderSent,
      };
    })
    .filter((item) => !reminderSent || (item.daysUntilDue <= 30 && item.daysUntilDue < 0));

  const overallStatus = dueItems.reduce<"green" | "amber" | "red">(
    (current, item) => (item.status === "red" || current === "red" ? "red" : item.status === "amber" || current === "amber" ? "amber" : "green"),
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
    overallStatus,
    dueItems,
  };
}

async function getClientSummaries() {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  const vehicles = await db.select().from(vehiclesTable);
  const sentRows = await db
    .select({ vehicleId: remindersLogTable.vehicleId })
    .from(remindersLogTable)
    .where(eq(remindersLogTable.sent, true));
  const sentVehicleIds = new Set(sentRows.map((row) => row.vehicleId));

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
      .map((vehicle) => buildVehicleStatus(vehicle, sentVehicleIds))
      .sort((a, b) => {
        const aSoonest = Math.min(...a.dueItems.map((item) => item.daysUntilDue), 9999);
        const bSoonest = Math.min(...b.dueItems.map((item) => item.daysUntilDue), 9999);
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
    (total, client) => total + client.vehicles.reduce((count, vehicle) => count + vehicle.dueItems.filter((item) => item.daysUntilDue <= 30).length, 0),
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
      lastServiceDate: formatDate(vehicle.lastServiceDate),
      nextServiceDue: formatDate(vehicle.nextServiceDue),
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
      lastServiceDate: formatDate(body.data.lastServiceDate),
      nextServiceDue: formatDate(body.data.nextServiceDue),
    })
    .returning();
  res.status(201).json(CreateVehicleResponse.parse(buildVehicleStatus(vehicle, new Set())));
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
  const [vehicle] = await db
    .update(vehiclesTable)
    .set({
      model: body.data.model,
      plate: body.data.plate,
      registrationExpiry: formatDate(body.data.registrationExpiry),
      insuranceExpiry: formatDate(body.data.insuranceExpiry),
      lastServiceDate: formatDate(body.data.lastServiceDate),
      nextServiceDue: formatDate(body.data.nextServiceDue),
    })
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  const sentRows = await db
    .select({ vehicleId: remindersLogTable.vehicleId })
    .from(remindersLogTable)
    .where(and(eq(remindersLogTable.vehicleId, vehicle.id), eq(remindersLogTable.sent, true)));
  res.json(UpdateVehicleResponse.parse(buildVehicleStatus(vehicle, new Set(sentRows.map((row) => row.vehicleId)))));
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
    const result = await callGemini(
      `Write one short, friendly WhatsApp-style message from a luxury car concierge. Return only valid JSON with exactly this shape: {"message":""}. Address the client by name, mention their car model, and clearly mention the ${parsed.data.dueLabel.toLowerCase()} date of ${formatDate(parsed.data.dueDate)}. It is ${parsed.data.daysUntilDue < 0 ? `${Math.abs(parsed.data.daysUntilDue)} days overdue` : `due in ${parsed.data.daysUntilDue} days`}. Do not use emojis. Client: ${parsed.data.clientName}. Car: ${parsed.data.model}, plate ${parsed.data.plate}.`,
    );
    res.json(DraftReminderResponse.parse(JSON.parse(result)));
  } catch (error) {
    req.log.error({ err: error }, "Gemini reminder drafting failed");
    res.status(502).json({ error: "Gemini could not draft this reminder. Check the Gemini API key and try again." });
  }
});

export default router;