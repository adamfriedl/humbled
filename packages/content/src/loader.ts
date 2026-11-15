import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { z } from "zod";
import type { PersonaType, PersonaTypeProfile } from "@humbled/domain";
import {
  CompanySchema,
  FormatGuideSchema,
  GoldenPostSchema,
  NudgeSchema,
  PersonaTypeModuleSchema,
  WorldEventSchema,
  type Company,
  type FormatGuide,
  type GoldenPost,
  type Nudge,
  type PersonaTypeModule,
  type WorldEvent,
} from "./schemas.ts";

/** Repo-root `content/` directory. */
export const DEFAULT_CONTENT_DIR = resolve(fileURLToPath(import.meta.url), "../../../../content");

export interface ContentBundle {
  houseStyle: string;
  safetyRules: string;
  rubric: string;
  formats: FormatGuide;
  personaTypes: ReadonlyMap<PersonaType, PersonaTypeModule>;
  companies: readonly Company[];
  events: readonly WorldEvent[];
  nudges: readonly Nudge[];
  golden: readonly GoldenPost[];
}

export class ContentError extends Error {}

function readYaml<S extends z.ZodType>(path: string, schema: S): z.infer<S> {
  const result = schema.safeParse(parse(readFileSync(path, "utf8")));
  if (!result.success) {
    throw new ContentError(
      `${path}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}

function uniqueBy<T>(items: readonly T[], key: (t: T) => string, what: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) throw new ContentError(`duplicate ${what}: ${k}`);
    seen.add(k);
  }
}

export function loadContent(dir: string = DEFAULT_CONTENT_DIR): ContentBundle {
  const personaDir = join(dir, "personas");
  const personaTypes = new Map<PersonaType, PersonaTypeModule>();
  for (const file of readdirSync(personaDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()) {
    const mod = readYaml(join(personaDir, file), PersonaTypeModuleSchema);
    if (`${mod.type}.yaml` !== file)
      throw new ContentError(`${file}: type "${mod.type}" must match file name`);
    personaTypes.set(mod.type, mod);
  }

  const companies = readYaml(join(dir, "world/companies.yaml"), CompanySchema.array().min(1));
  const events = readYaml(join(dir, "world/events.yaml"), WorldEventSchema.array().min(1));
  const nudges = readYaml(join(dir, "world/nudges.yaml"), NudgeSchema.array().min(1));
  const golden = readYaml(join(dir, "eval/golden/candidates.yaml"), GoldenPostSchema.array());
  uniqueBy(companies, (c) => c.name.toLowerCase(), "company");
  uniqueBy(events, (e) => e.id, "event id");
  uniqueBy(nudges, (n) => n.id, "nudge id");
  uniqueBy(golden, (g) => g.id, "golden id");
  if (events.filter((e) => e.launch).length > 1) throw new ContentError("at most one launch event");

  return {
    houseStyle: readFileSync(join(dir, "style/house-style.md"), "utf8"),
    safetyRules: readFileSync(join(dir, "style/safety.md"), "utf8"),
    rubric: readFileSync(join(dir, "eval/rubric.md"), "utf8"),
    formats: readYaml(join(dir, "style/formats.yaml"), FormatGuideSchema),
    personaTypes,
    companies,
    events,
    nudges,
    golden,
  };
}

/** Project a type module onto the planner's profile shape. */
export function toPlannerProfile(mod: PersonaTypeModule): PersonaTypeProfile {
  return {
    type: mod.type,
    actionRates: mod.action_rates,
    formatWeights: mod.format_weights,
    reactionWeights: mod.reaction_weights,
  };
}
