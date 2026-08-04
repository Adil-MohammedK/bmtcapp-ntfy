import type { Snapshot } from "../types";
export async function loadTracker(route: string, stop: string): Promise<Snapshot> {
  const response = await fetch(`/api/tracker?route=${encodeURIComponent(route)}&stop=${encodeURIComponent(stop)}`);
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? "Transit service is unavailable"); }
  return response.json() as Promise<Snapshot>;
}
