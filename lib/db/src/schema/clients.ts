import { createInsertSchema } from "drizzle-zod";
import { date, numeric, pgTable, serial, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  tier: text("tier").notNull().default("Signature"),
  retainerAmount: numeric("retainer_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  clientSince: date("client_since", { mode: "string" }).notNull().defaultNow(),
  notes: text("notes").notNull().default(""),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;