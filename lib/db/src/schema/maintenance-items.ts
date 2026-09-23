import { createInsertSchema } from "drizzle-zod";
import { integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const maintenanceItemsTable = pgTable("maintenance_items", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  costAed: numeric("cost_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  changeIntervalKm: integer("change_interval_km").notNull(),
  lastChangedKm: integer("last_changed_km").notNull(),
  nextDueKm: integer("next_due_km").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMaintenanceItemSchema = createInsertSchema(maintenanceItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaintenanceItem = z.infer<typeof insertMaintenanceItemSchema>;
export type MaintenanceItem = typeof maintenanceItemsTable.$inferSelect;