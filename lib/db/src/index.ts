import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase (and most hosted Postgres providers) require SSL, and its
// certificate isn't in Node's default trust store, so we accept it without
// strict verification - this matches Supabase's own connection guidance.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

// Diagnostic: print the real connection error to the logs at startup,
// since the app's normal error logging only shows Drizzle's wrapper
// message ("Failed query...") and hides the underlying cause.
pool
  .query("select 1")
  .then(() => {
    console.log("DB_DIAGNOSTIC: connection OK");
  })
  .catch((err) => {
    console.error("DB_DIAGNOSTIC: connection FAILED");
    console.error("DB_DIAGNOSTIC code:", err?.code);
    console.error("DB_DIAGNOSTIC message:", err?.message);
    console.error("DB_DIAGNOSTIC full:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
  });

export * from "./schema";
