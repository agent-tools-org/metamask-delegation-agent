import { decodeAbiParameters, formatEther, type Address } from "viem";
import { type Delegation, CaveatType } from "../delegation/types.js";
import { DELEGATION_FRAMEWORK } from "../config.js";
import { trackSpending } from "./delegated-agent.js";

/* ------------------------------------------------------------------ */
/*  Caveat-type lookup (shared helper)                                */
/* ------------------------------------------------------------------ */

function caveatTypeOf(enforcer: Address): CaveatType | null {
  const map: Record<string, CaveatType> = {
    [DELEGATION_FRAMEWORK.spendingLimitEnforcer.toLowerCase()]:
      CaveatType.SpendingLimit,
    [DELEGATION_FRAMEWORK.timeBoundEnforcer.toLowerCase()]:
      CaveatType.TimeBound,
    [DELEGATION_FRAMEWORK.allowedTargetsEnforcer.toLowerCase()]:
      CaveatType.ContractTarget,
    [DELEGATION_FRAMEWORK.erc20AllowanceEnforcer.toLowerCase()]:
      CaveatType.TokenAllowance,
  };
  return map[enforcer.toLowerCase()] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Human-readable permission summary                                 */
/* ------------------------------------------------------------------ */

/**
 * Produce a human-readable string describing what the delegation allows.
 *
 * Example output:
 *   "This agent can: spend up to 0.01 ETH/tx (0.1 ETH/day),
 *    only interact with 0xABC…, valid until 2025-03-31T00:00:00Z"
 */
export function summarisePermissions(delegation: Delegation): string {
  const parts: string[] = [];

  for (const caveat of delegation.caveats) {
    const ct = caveatTypeOf(caveat.enforcer);

    switch (ct) {
      case CaveatType.SpendingLimit: {
        const [maxTx, maxDay] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          caveat.terms,
        );
        parts.push(
          `spend up to ${formatEther(maxTx)} ETH/tx (${formatEther(maxDay)} ETH/day)`,
        );
        break;
      }
      case CaveatType.TimeBound: {
        const [from, until] = decodeAbiParameters(
          [{ type: "uint128" }, { type: "uint128" }],
          caveat.terms,
        );
        const fromStr = new Date(Number(from) * 1000).toISOString();
        const untilStr = new Date(Number(until) * 1000).toISOString();
        parts.push(`valid from ${fromStr} until ${untilStr}`);
        break;
      }
      case CaveatType.ContractTarget: {
        const [targets] = decodeAbiParameters(
          [{ type: "address[]" }],
          caveat.terms,
        );
        const short = (targets as string[]).map(
          (t) => `${t.slice(0, 6)}…${t.slice(-4)}`,
        );
        parts.push(`only interact with ${short.join(", ")}`);
        break;
      }
      case CaveatType.TokenAllowance: {
        const [token, allowance] = decodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          caveat.terms,
        );
        parts.push(
          `token ${(token as string).slice(0, 6)}…${(token as string).slice(-4)} allowance ${allowance}`,
        );
        break;
      }
      default:
        break;
    }
  }

  if (parts.length === 0) return "This agent has no constrained permissions.";
  return `This agent can: ${parts.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/*  Expiry check                                                      */
/* ------------------------------------------------------------------ */

/** Returns true if the delegation is currently valid (not expired). */
export function isDelegationValid(delegation: Delegation): boolean {
  const now = Math.floor(Date.now() / 1000);

  for (const caveat of delegation.caveats) {
    if (caveatTypeOf(caveat.enforcer) === CaveatType.TimeBound) {
      const [from, until] = decodeAbiParameters(
        [{ type: "uint128" }, { type: "uint128" }],
        caveat.terms,
      );
      if (now < Number(from) || now > Number(until)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Spending-limit alerts                                             */
/* ------------------------------------------------------------------ */

export interface SpendingAlert {
  /** true when cumulative spend exceeds 80 % of the daily cap */
  nearLimit: boolean;
  /** Percentage of daily cap consumed (0 – 100+) */
  percentUsed: number;
  message: string;
}

/** Check if the agent is approaching its spending limit (>80 %). */
export function checkSpendingAlert(delegation: Delegation): SpendingAlert {
  const record = trackSpending(delegation);

  if (record.maxPerDay === BigInt(0)) {
    return {
      nearLimit: false,
      percentUsed: 0,
      message: "No spending limit configured",
    };
  }

  const pct =
    Number((record.totalSpent * BigInt(10000)) / record.maxPerDay) / 100;

  if (pct >= 100) {
    return {
      nearLimit: true,
      percentUsed: pct,
      message: `⛔ Daily spending limit reached (${pct.toFixed(1)}% used)`,
    };
  }
  if (pct >= 80) {
    return {
      nearLimit: true,
      percentUsed: pct,
      message: `⚠️ Approaching daily spending limit (${pct.toFixed(1)}% used)`,
    };
  }

  return {
    nearLimit: false,
    percentUsed: pct,
    message: `✅ Spending within bounds (${pct.toFixed(1)}% of daily limit used)`,
  };
}
