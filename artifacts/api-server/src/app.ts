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

export default app;
