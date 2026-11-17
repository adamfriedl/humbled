// Server-only wiring: one connection pool and config per server process.
import "server-only";
import { configOverrides, loadConfig, type Config } from "@humbled/config";
import { connect, WebQueries, type DbHandle } from "@humbled/db";

const globalForDb = globalThis as unknown as { humbledDb?: DbHandle; humbledConfig?: Config };

export function config(): Config {
  globalForDb.humbledConfig ??= loadConfig(configOverrides(process.env.HUMBLED_CONFIG));
  return globalForDb.humbledConfig;
}

/** Reuses one pool across requests (and across hot reloads in dev). */
export function queries(): WebQueries {
  if (!globalForDb.humbledDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.humbledDb = connect(url, { max: 10 });
  }
  return new WebQueries(globalForDb.humbledDb.db);
}
