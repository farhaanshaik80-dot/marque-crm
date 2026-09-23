# Marque CRM

Marque CRM helps a small luxury car concierge team manage client relationships, vehicle due dates, and thoughtful WhatsApp reminders.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/marque-crm` — React/Vite dashboard, client intake, client detail, vehicle editing, and reminder flows.
- `artifacts/api-server/src/routes/marque.ts` — Express API routes, due-date logic, seed data, and Gemini calls.
- `lib/db/src/schema` — Drizzle tables for clients, vehicles, and `reminders_log`.
- `lib/api-spec/openapi.yaml` — source of truth for the typed API client and Zod schemas.
- `artifacts/marque-crm/src/index.css` — visual theme and layout utilities.

## Architecture decisions

- Calendar-only dates use PostgreSQL `date` columns and are normalized at the API boundary to avoid timezone shifts.
- A sent reminder is tracked per vehicle and suppresses active due items for that vehicle on the dashboard.
- Gemini is called server-side with `GEMINI_API_KEY`; the browser never receives the secret.
- AI responses are requested as JSON and validated with the generated API schemas before returning to the UI.

## Product

- Dashboard shows all clients and vehicles, with soonest due dates first and green/amber/red status.
- New-client flow is a single direct form for client details and their first vehicle.
- Client detail supports editing client and vehicle records, adding vehicles, viewing reminder history, drafting WhatsApp copy, opening WhatsApp, and marking messages sent.

## User preferences

- Use Gemini through `GEMINI_API_KEY` for reminder drafting.

## Gotchas

- Do not expose `GEMINI_API_KEY` to frontend code; all AI calls belong in the API server.
- The API seed check is guarded against concurrent first requests because dashboard and client queries load in parallel.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
