import { createInsertSchema } from "drizzle-zod";
import { date, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  plate: text("plate").notNull(),
  registrationExpiry: date("registration_expiry", { mode: "string" }).notNull(),
  insuranceExpiry: date("insurance_expiry", { mode: "string" }).notNull(),
  lastServiceDate: date("last_service_date", { mode: "string" }).notNull(),
  nextServiceDue: date("next_service_due", { mode: "string" }).notNull(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;