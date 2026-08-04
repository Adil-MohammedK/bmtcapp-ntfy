import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTrackerSnapshot, searchRoutes } from "./transit.js";
import { getMonitorStatus, runMonitor, sendTestNotification, startMonitor } from "./monitor.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(cors());
app.use(express.json());
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web/dist");

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/monitor/status", (_req, res) => res.json(getMonitorStatus()));
app.post("/api/monitor/check", async (_req, res, next) => {
  try { await runMonitor(); res.json(getMonitorStatus()); } catch (error) { next(error); }
});
app.post("/api/monitor/test", async (req, res, next) => {
  if (!process.env.NOTIFICATION_TEST_TOKEN || req.header("x-notification-test-token") !== process.env.NOTIFICATION_TEST_TOKEN) {
    return res.status(403).json({ error: "A valid x-notification-test-token is required" });
  }
  try {
    const result = await sendTestNotification();
    res.status(result.sent.length ? 200 : 502).json({ ok: result.sent.length > 0, ...result });
  } catch (error) { next(error); }
});
app.get("/api/routes", async (req, res, next) => {
  try { res.json(await searchRoutes(String(req.query.q ?? ""))); } catch (error) { next(error); }
});
app.get("/api/tracker", async (req, res, next) => {
  const routeNo = String(req.query.route ?? "314-P").trim();
  const stopId = String(req.query.stop ?? "21945").trim();
  try { res.json(await getTrackerSnapshot(routeNo, stopId)); } catch (error) { next(error); }
});
app.use(express.static(webRoot));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(webRoot, "index.html"), (error) => error ? next() : undefined);
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unable to load transit data";
  res.status(502).json({ error: message });
});
app.listen(port, () => {
  console.log(`BMTC API listening on http://localhost:${port}`);
  startMonitor();
});
