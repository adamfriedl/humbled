import type { Config } from "@humbled/config";

export type BudgetDecision =
  | { mode: "normal"; activityMultiplier: 1 }
  | { mode: "throttled"; activityMultiplier: number }
  /** Generation ticks are skipped; code-only actions (react, follow, endorse) continue. */
  | { mode: "generation_paused"; activityMultiplier: number };

/** CR-7: decide tick behavior from today's batch/tick spend. */
export function budgetDecision(spentTodayUsd: number, budget: Config["budget"]): BudgetDecision {
  const limit = budget.dailyLlmBudgetUsd;
  if (limit <= 0 || spentTodayUsd >= limit) {
    return { mode: "generation_paused", activityMultiplier: budget.softLimitActivityMultiplier };
  }
  if (spentTodayUsd >= limit * budget.softLimitFraction) {
    return { mode: "throttled", activityMultiplier: budget.softLimitActivityMultiplier };
  }
  return { mode: "normal", activityMultiplier: 1 };
}

/** CR-7: real-time calls have their own budget so a creation spike can't starve house bots. */
export function realtimeAllowed(spentRealtimeTodayUsd: number, budget: Config["budget"]): boolean {
  return spentRealtimeTodayUsd < budget.dailyRealtimeBudgetUsd;
}
