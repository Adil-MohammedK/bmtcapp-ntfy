import { getAnyLiveBusAtStop, getTrackerSnapshot } from "./transit.js";
import type { ApproachingBus } from "./types.js";
import https from "node:https";

const TIME_ZONE = "Asia/Kolkata";
const INTERVAL_MS = 60_000;
const ETA_LIMIT = Number(process.env.ALERT_ETA_MINUTES ?? 10);
const MORNING_STOP_ID = process.env.MORNING_STOP_ID ?? process.env.ALERT_STOP_ID ?? "21945";
const EVENING_STOP_ID = process.env.EVENING_STOP_ID ?? process.env.ALERT_STOP_ID ?? "21702";
const MORNING_ROUTES = (process.env.MORNING_ROUTES ?? "314-A,314-B").split(",").map((item) => item.trim()).filter(Boolean);
const EVENING_ROUTES = (process.env.EVENING_ROUTES ?? "314-A,314-B").split(",").map((item) => item.trim()).filter(Boolean);

export interface MonitorStatus {
  active: boolean;
  window: "morning" | "evening" | null;
  direction: "up" | "down" | null;
  routes: string[];
  targetStopId: string;
  etaLimitMinutes: number;
  provider: "ntfy" | "home-assistant" | null;
  providers: Array<"ntfy" | "home-assistant">;
  lastRunAt: string | null;
  lastError: string | null;
}

let lastRunAt: string | null = null;
let lastError: string | null = null;
const delivered = new Set<string>();
type Provider = "ntfy" | "home-assistant";
type NotifyResult = { sent: Provider[]; errors: string[] };

function enabled(name: "INFO" | "DEBUG") {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value && !["0", "false", "no", "off"].includes(value));
}
function info(...values: unknown[]) { if (enabled("INFO") || enabled("DEBUG")) console.info("[bmtc-monitor]", ...values); }
function debug(...values: unknown[]) { if (enabled("DEBUG")) console.debug("[bmtc-monitor]", ...values); }

function indiaClock() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts();
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}

function activeWindow(): Omit<MonitorStatus, "targetStopId" | "etaLimitMinutes" | "provider" | "providers" | "lastRunAt" | "lastError"> {
  const { hour, minute } = indiaClock();
  const now = hour * 60 + minute;
  if (now >= 4 * 60 && now <= 10 * 60 + 30) return { active: true, window: "morning", direction: "up", routes: MORNING_ROUTES };
  if (now >= 16 * 60 && now <= 18 * 60 + 30) return { active: true, window: "evening", direction: "down", routes: EVENING_ROUTES };
  return { active: false, window: null, direction: null, routes: [] };
}

function providers(): Provider[] {
  const result: Provider[] = [];
  if (process.env.NTFY_TOPIC) result.push("ntfy");
  if (process.env.HA_URL && process.env.HA_TOKEN && process.env.HA_NOTIFY_SERVICE) result.push("home-assistant");
  return result;
}

export function getMonitorStatus(): MonitorStatus {
  const window = activeWindow();
  const targetStopId = window.window === "morning" ? MORNING_STOP_ID : EVENING_STOP_ID;
  const activeProviders = providers();
  return { ...window, targetStopId, etaLimitMinutes: ETA_LIMIT, provider: activeProviders[0] ?? null, providers: activeProviders, lastRunAt, lastError };
}

function minutesFromEta(eta: ApproachingBus["eta"]): number | null {
  if (typeof eta === "number" && Number.isFinite(eta)) return eta;
  if (typeof eta !== "string") return null;
  const match = eta.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function postToNtfy(url: string, title: string, message: string): Promise<number> {
  // Node's HTTPS headers reject Unicode (for example, an em dash). The body
  // still carries the full text; use a safe ASCII title header for ntfy.
  const headerTitle = title.replace(/[^\x20-\x7E]/g, "-");
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      // Some networks advertise unusable IPv6 routes; curl commonly falls back
      // while Node's fetch may not. IPv4 is configurable for IPv6-only setups.
      family: process.env.NTFY_FORCE_IPV4 === "false" ? undefined : 4,
      headers: { Title: headerTitle, Tags: "bus,warning", Priority: "high", "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(message) },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(message);
  });
}

async function notifyNtfy(title: string, message: string) {
    const baseUrl = (process.env.NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");
    try {
      const status = await postToNtfy(`${baseUrl}/${encodeURIComponent(process.env.NTFY_TOPIC!)}`, title, message);
      if (status < 200 || status >= 300) throw new Error(`ntfy returned ${status}`);
    } catch (error) {
      const detail = error instanceof Error ? error.cause instanceof Error ? error.cause.message : error.message : "unknown network error";
      throw new Error(`Unable to reach ntfy at ${baseUrl}: ${detail}`);
    }
}

async function notifyHomeAssistant(title: string, message: string) {
  const response = await fetch(`${process.env.HA_URL!.replace(/\/$/, "")}/api/services/notify/${encodeURIComponent(process.env.HA_NOTIFY_SERVICE!)}`, { method: "POST", headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ title, message }) });
  if (!response.ok) throw new Error(`Home Assistant returned ${response.status}`);
}

async function notify(title: string, message: string, targets = providers()): Promise<NotifyResult> {
  const outcomes = await Promise.all(targets.map(async (target) => {
    try {
      if (target === "ntfy") await notifyNtfy(title, message);
      else await notifyHomeAssistant(title, message);
      info(`Delivered notification through ${target}`);
      return { target, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification error";
      console.error(`[bmtc-monitor] ${target} notification failed:`, message);
      return { target, error: message };
    }
  }));
  return { sent: outcomes.filter((outcome) => !outcome.error).map((outcome) => outcome.target), errors: outcomes.filter((outcome) => outcome.error).map((outcome) => `${outcome.target}: ${outcome.error}`) };
}

export async function sendTestNotification() {
  const configured = providers();
  if (!configured.length) throw new Error("Configure NTFY_TOPIC and/or Home Assistant notification settings first");
  const testStopId = "21945";
  try {
    const bus = await getAnyLiveBusAtStop(testStopId);
    if (bus) {
      const stop = bus.targetStopName ? `${bus.targetStopName} (stop ${testStopId})` : `stop ${testStopId}`;
      const eta = bus.eta ? `\nReported ETA: ${bus.eta}` : "";
      return notify("BMTC tracker test — live bus found", `Live service currently reported for stop ${testStopId}\nRoute: ${bus.routeNo}\nBus: ${bus.vehicleNumber}\nRoute: ${bus.routeStart} → ${bus.routeEnd}\nDestination: ${stop}${eta}\n\nLive alerts will use the same notification channels.`, configured);
    }
  } catch (error) {
    debug("Live test lookup failed; using sample notification", error);
  }
  return notify("BMTC tracker test — sample data", "No currently running service was found for stop 21945, so this is sample data.\nRoute: 314-A · UP\nBus: KA-01-AB-1234\nRoute: Shivajinagara Bus Station → Malleshpalya New Bus Station\nDestination: Ganesha Temple Thippasandra (stop 21945)\nSample ETA: about 8 minutes\n\nLive alerts will use the same notification channels.", configured);
}

async function checkRoute(routeNo: string, direction: "up" | "down", window: "morning" | "evening", targetStopId: string) {
  const snapshot = await getTrackerSnapshot(routeNo, targetStopId);
  for (const bus of snapshot.approaching.filter((item) => item.direction === direction && item.servesTarget)) {
    const eta = minutesFromEta(bus.eta);
    if (eta === null || eta > ETA_LIMIT) continue;
    const key = `${window}:${targetStopId}:${routeNo}:${bus.vehicleId}`;
    const missingProviders = providers().filter((target) => !delivered.has(`${key}:${target}`));
    if (!missingProviders.length) continue;
    const target = bus.targetStopName ? `${bus.targetStopName} (stop ${targetStopId})` : `stop ${targetStopId}`;
    const journey = bus.routeStart && bus.routeEnd ? `\nRoute: ${bus.routeStart} → ${bus.routeEnd}` : "";
    const result = await notify("BMTC bus approaching", `Route: ${routeNo} · ${bus.direction.toUpperCase()}\nBus: ${bus.vehicleNumber}${journey}\nDestination: ${target}\nETA: about ${Math.ceil(eta)} min.`, missingProviders);
    result.sent.forEach((target) => delivered.add(`${key}:${target}`));
    if (result.errors.length) lastError = result.errors.join("; ");
    debug(`Checked ${routeNo} ${bus.vehicleNumber}: ETA ${eta}, sent through ${result.sent.join(", ") || "none"}`);
  }
}

export async function runMonitor() {
  const status = getMonitorStatus();
  lastRunAt = new Date().toISOString();
  lastError = null;
  if (!status.active || !status.direction || !status.window || !status.providers.length) {
    info(`Monitor idle: window=${status.window ?? "none"}, providers=${status.providers.join(",") || "none"}`);
    return;
  }
  info(`Checking ${status.routes.join(", ")} ${status.direction.toUpperCase()} for stop ${status.targetStopId} through ${status.providers.join(", ")}`);
  try { await Promise.all(status.routes.map((route) => checkRoute(route, status.direction!, status.window!, status.targetStopId))); }
  catch (error) { lastError = error instanceof Error ? error.message : "Monitor failed"; console.error("BMTC notification monitor:", error); }
}

export function startMonitor() {
  info("Notification monitor started");
  void runMonitor();
  setInterval(() => void runMonitor(), INTERVAL_MS);
}
