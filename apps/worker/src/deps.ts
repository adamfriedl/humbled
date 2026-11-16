import type { PersonaCard } from "@humbled/comedy";
import type { Config } from "@humbled/config";
import type { ContentBundle } from "@humbled/content";
import type { PersonaRow, Repositories } from "@humbled/db";
import type { Clock } from "@humbled/domain";
import type { LLMClient, SpendLedger } from "@humbled/llm";

/** Everything a handler needs. Production wires real adapters; tests wire fakes and a container. */
export interface WorkerDeps {
  repos: Repositories;
  ledger: SpendLedger;
  llm: LLMClient;
  content: ContentBundle;
  config: Config;
  clock: Clock;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

/** Structured JSON logs on stdout, which Cloud Logging parses (severity, message, fields). */
export function jsonLogger(severity = "INFO") {
  return (event: string, fields: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ severity, message: event, ...fields }));
}

/** The prompt builders' view of a persona. Canon is stored as jsonb; missing lists are empty. */
export function personaCard(p: PersonaRow): PersonaCard {
  const canon = p.canon as {
    family?: string[];
    employers?: string[];
    facts?: string[];
    subtext?: string;
  };
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    title: p.title,
    company: p.company,
    origin: p.origin,
    canon: {
      family: canon.family ?? [],
      employers: canon.employers ?? [],
      facts: canon.facts ?? [],
    },
    ...(canon.subtext ? { subtext: canon.subtext } : {}),
  };
}
