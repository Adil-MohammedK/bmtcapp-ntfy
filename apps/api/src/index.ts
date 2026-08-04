import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTrackerSnapshot, searchRoutes } from "./transit.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(cors());
app.use(express.json());
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web/dist");

app.get("/health", (_req, res) => res.json({ ok: true }));
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
app.listen(port, () => console.log(`BMTC API listening on http://localhost:${port}`));
