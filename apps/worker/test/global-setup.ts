import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { connect, migrate } from "@humbled/db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * One Postgres 16 + pgvector container for the whole test run (the same image as
 * docker-compose.yml), migrated once. Set DATABASE_URL to use an existing database instead.
 */
export async function setup(project: TestProject): Promise<void> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    url = container.getConnectionUri();
  }
  const h = connect(url);
  await migrate(h.db);
  await h.close();
  project.provide("databaseUrl", url);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
