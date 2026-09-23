import { createInsertSchema } from "drizzle-zod";
import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  model: text("model").notNull().default(""),
  plate: text("plate").notNull().default(""),
  registrationExpiry: date("registration_expiry", { mode: "string" }),
  insuranceExpiry: date("insurance_expiry", { mode: "string" }),
  lastServiceDate: date("last_service_date", { mode: "string" }),
  nextServiceDue: date("next_service_due", { mode: "string" }),
  currentOdometer: integer("current_odometer").notNull().default(0),
  serviceIntervalKm: integer("service_interval_km").notNull().default(0),
  nextServiceDueOdometer: integer("next_service_due_odometer").notNull().default(0),
  odometerUpdatedAt: timestamp("odometer_updated_at", { withTimezone: true }).notNull().defaultNow(),
  odometerLastAskedAt: timestamp("odometer_last_asked_at", { withTimezone: true }),
  mulkiyaImagePath: text("mulkiya_image_path"),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;