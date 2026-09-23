import { createInsertSchema } from "drizzle-zod";
import { boolean, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { vehiclesTable } from "./vehicles";

export const remindersLogTable = pgTable("reminders_log", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  dueKey: text("due_key").notNull().default("general"),
  messageText: text("message_text").notNull(),
  draftedAt: timestamp("drafted_at", { withTimezone: true }).notNull().defaultNow(),
  sent: boolean("sent").notNull().default(false),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const insertReminderSchema = createInsertSchema(remindersLogTable).omit({ id: true, draftedAt: true });
export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type Reminder = typeof remindersLogTable.$inferSelect;