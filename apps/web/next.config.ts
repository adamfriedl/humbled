import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export TypeScript source (with .ts import extensions); Next compiles them.
  transpilePackages: ["@humbled/config", "@humbled/db", "@humbled/domain", "@humbled/llm"],
  // A self-contained server for the Cloud Run image.
  output: "standalone",
  // Trace from the monorepo root so the standalone server includes workspace packages.
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  // Share-card fonts are read from disk at request time, so the tracer can't see them.
  outputFileTracingIncludes: { "/**/opengraph-image": ["./assets/fonts/*"] },
  // pg is a Node library with optional native bindings; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default config;
