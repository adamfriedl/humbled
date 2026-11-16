import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/schema.ts (`pnpm --filter @humbled/db generate`) and
// committed. They run at deploy time and at the start of every integration test run.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
