import { createInsertSchema } from "drizzle-zod";
import { date, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const maintenanceItemsTable = pgTable("maintenance_items", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull().default("maintenance"),
  name: text("name").notNull(),
  costAed: numeric("cost_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  currentKm: integer("current_km"),
  lastChangedKm: integer("last_changed_km"),
  changeIntervalKm: integer("change_interval_km"),
  nextDueKm: integer("next_due_km"),
  dateRecorded: date("date_recorded", { mode: "string" }).notNull().defaultNow(),
  photoObjectPath: text("photo_object_path"),
  photoOriginalFileName: text("photo_original_file_name"),
  photoContentType: text("photo_content_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMaintenanceItemSchema = createInsertSchema(maintenanceItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaintenanceItem = z.infer<typeof insertMaintenanceItemSchema>;
export type MaintenanceItem = typeof maintenanceItemsTable.$inferSelect;