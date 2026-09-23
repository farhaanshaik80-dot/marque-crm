import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const vehicleUpdateHistoryTable = pgTable("vehicle_update_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  fieldChanged: text("field_changed").notNull(),
  oldValue: text("old_value").notNull(),
  newValue: text("new_value").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleUpdateHistorySchema = createInsertSchema(vehicleUpdateHistoryTable).omit({ id: true, changedAt: true });
export type InsertVehicleUpdateHistory = z.infer<typeof insertVehicleUpdateHistorySchema>;
export type VehicleUpdateHistory = typeof vehicleUpdateHistoryTable.$inferSelect;