import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

// On Replit, the frontend and backend were deployed as two separate
// services that Replit's own infrastructure stitched together under one
// domain. Render runs a single service, so this backend also serves the
// frontend's built files directly (one process, one URL, no separate
// hosting needed). This is a no-op in local dev, where the frontend runs
// on its own via `vite`.
const frontendDistDir = path.resolve(
  process.cwd(),
  "artifacts/marque-crm/dist/public",
);

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDistDir, "index.html"));
  });
}

// Diagnostic: Express's default error handler doesn't print the real
// underlying error (e.g. Drizzle wraps Postgres errors and only the
// wrapper message normally surfaces in logs). This prints everything,
// including the original cause, so we can see the true root cause.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("APP_ERROR message:", err?.message);
  console.error("APP_ERROR cause:", err?.cause?.message ?? err?.cause);
  console.error("APP_ERROR cause code:", err?.cause?.code);
  console.error(
    "APP_ERROR full:",
    JSON.stringify(err, Object.getOwnPropertyNames(err)),
  );
  if (err?.cause) {
    console.error(
      "APP_ERROR cause full:",
      JSON.stringify(err.cause, Object.getOwnPropertyNames(err.cause)),
    );
  }
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
