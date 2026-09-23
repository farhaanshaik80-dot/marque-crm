import { createInsertSchema } from "drizzle-zod";
import { date, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { vehiclesTable } from "./vehicles";

export const clientDocumentsTable = pgTable("client_documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id, { onDelete: "set null" }),
  documentType: text("document_type").notNull(),
  documentDate: date("document_date", { mode: "string" }).notNull(),
  amountAed: numeric("amount_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  vendorName: text("vendor_name").notNull(),
  description: text("description").notNull(),
  warrantyExpiry: date("warranty_expiry", { mode: "string" }),
  objectPath: text("object_path").notNull(),
  originalFileName: text("original_file_name").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientDocumentSchema = createInsertSchema(clientDocumentsTable).omit({ id: true, createdAt: true });
export type InsertClientDocument = z.infer<typeof insertClientDocumentSchema>;
export type ClientDocument = typeof clientDocumentsTable.$inferSelect;