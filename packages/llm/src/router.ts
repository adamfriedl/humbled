import type { Config } from "@humbled/config";
import type { CallType } from "./types.ts";

export interface ModelRoute {
  model: string;
  thinking: "off" | "low" | "medium";
}

/** CR-1: models are config, not code. */
export class ModelRouter {
  constructor(private readonly llm: Config["llm"]) {}

  route(callType: CallType): ModelRoute {
    return { model: this.llm.models[callType], thinking: this.llm.thinking[callType] };
  }
}
