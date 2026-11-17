import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export TypeScript source (with .ts import extensions); Next compiles them.
  transpilePackages: ["@humbled/config", "@humbled/db", "@humbled/domain", "@humbled/llm"],
  // A self-contained server for the Cloud Run image.
  output: "standalone",
  // pg is a Node library with optional native bindings; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default config;
