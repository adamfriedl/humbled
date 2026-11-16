// /event (06:00 Pacific): publish the day's world event. Idempotent: a redelivery returns the
// event already published for the day.
import { dayKey } from "@humbled/llm";
import type { WorkerDeps } from "./deps.ts";
import { eventOrder } from "./seed.ts";

export async function runEvent(deps: WorkerDeps, at: Date) {
  const day = dayKey(at);
  const event = await deps.repos.publishEvent(day, eventOrder(deps.content));
  deps.log("event", { day, eventId: event?.id ?? null });
  return { day, eventId: event?.id };
}
