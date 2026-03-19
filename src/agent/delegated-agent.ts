import { decodeAbiParameters, type Address, type Hex } from "viem";
import {
  type Delegation,
  type AgentAction,
  CaveatType,
} from "../delegation/types.js";
import { DELEGATION_FRAMEWORK } from "../config.js";

/* ------------------------------------------------------------------ */
/*  Permission descriptor                                             */
/* ------------------------------------------------------------------ */

export interface Permission {
  type: CaveatType;
  description: string;
  params: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Spending tracker                                                  */
/* ------------------------------------------------------------------ */

export interface SpendingRecord {
  totalSpent: bigint;
  maxPerTransaction: bigint;
  maxPerDay: bigint;
  transactions: { value: bigint; timestamp: number }[];
}

/**
 * Production note: spending tracking should be persisted (e.g. DB/kv-store) so
 * process restarts cannot reset safety limits.
 *
 * Demo scope: this is an in-memory ledger.
 */
const spendingLedger = new Map<string, SpendingRecord>();

const WARN_ON_SPENDING_LEDGER_RESET =
  process.env.SPENDING_LEDGER_WARN_ON_RESET === "true";

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function ledgerKey(delegation: Delegation, now = new Date()): string {
  return `${delegation.salt}-${utcDayKey(now)}`;
}

/* ------------------------------------------------------------------ */
/*  Caveat decoders (mirror builder encoders)                         */
/* ------------------------------------------------------------------ */

function decodeCaveatType(enforcer: Address): CaveatType | null {
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
/*  checkPermissions                                                  */
/* ------------------------------------------------------------------ */

/** Inspect a delegation and return a structured list of permissions. */
export function checkPermissions(delegation: Delegation): Permission[] {
  const perms: Permission[] = [];

  for (const caveat of delegation.caveats) {
    const ct = decodeCaveatType(caveat.enforcer);
    if (!ct) continue;

    switch (ct) {
      case CaveatType.SpendingLimit: {
        const [maxTx, maxDay] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          caveat.terms,
        );
        perms.push({
          type: ct,
          description: `Spend up to ${maxTx} wei/tx, ${maxDay} wei/day`,
          params: {
            maxPerTransaction: maxTx.toString(),
            maxPerDay: maxDay.toString(),
          },
        });
        break;
      }
      case CaveatType.TimeBound: {
        const [from, until] = decodeAbiParameters(
          [{ type: "uint128" }, { type: "uint128" }],
          caveat.terms,
        );
        perms.push({
          type: ct,
          description: `Valid from ${new Date(Number(from) * 1000).toISOString()} until ${new Date(Number(until) * 1000).toISOString()}`,
          params: { validFrom: Number(from), validUntil: Number(until) },
        });
        break;
      }
      case CaveatType.ContractTarget: {
        const [targets] = decodeAbiParameters(
          [{ type: "address[]" }],
          caveat.terms,
        );
        perms.push({
          type: ct,
          description: `Restricted to contracts: ${(targets as string[]).join(", ")}`,
          params: { allowedTargets: targets },
        });
        break;
      }
      case CaveatType.TokenAllowance: {
        const [token, allowance] = decodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          caveat.terms,
        );
        perms.push({
          type: ct,
          description: `Token ${token}: allowance ${allowance}`,
          params: { token, allowance: allowance.toString() },
        });
        break;
      }
    }
  }

  return perms;
}

/* ------------------------------------------------------------------ */
/*  Spending tracking                                                 */
/* ------------------------------------------------------------------ */

function minOrUnset(current: bigint, candidate: bigint): bigint {
  if (candidate === BigInt(0)) return current;
  if (current === BigInt(0)) return candidate;
  return candidate < current ? candidate : current;
}

/** Return the current spending record for a delegation. */
export function trackSpending(delegation: Delegation): SpendingRecord {
  const key = ledgerKey(delegation);
  if (spendingLedger.has(key)) return spendingLedger.get(key)!;

  // Initialise from the most restrictive spending-limit caveats
  let maxTx = BigInt(0);
  let maxDay = BigInt(0);
  for (const caveat of delegation.caveats) {
    if (decodeCaveatType(caveat.enforcer) === CaveatType.SpendingLimit) {
      const [mt, md] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        caveat.terms,
      );
      maxTx = minOrUnset(maxTx, mt);
      maxDay = minOrUnset(maxDay, md);
    }
  }

  const record: SpendingRecord = {
    totalSpent: BigInt(0),
    maxPerTransaction: maxTx,
    maxPerDay: maxDay,
    transactions: [],
  };
  spendingLedger.set(key, record);
  return record;
}

/** Reset the global spending ledger (for testing). */
export function resetSpendingLedger(resetWarning = false): void {
  // Warning exists because in-memory tracking resets on process restart.
  // Production deployments must persist spending state.
  if (resetWarning || WARN_ON_SPENDING_LEDGER_RESET) {
    console.warn(
      "[metamask-delegation-agent] Spending ledger has been reset (in-memory demo). In production, persist this state to prevent restart bypass.",
    );
  }
  spendingLedger.clear();
}

/* ------------------------------------------------------------------ */
/*  Validation helpers                                                */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const ERC20_TRANSFER_FROM_SELECTOR = "0x23b872dd";

function decodeErc20AmountFromCalldata(data: Hex): bigint | null {
  if (data === "0x") return null;
  if (data.length < 10) return null;

  const selector = data.slice(0, 10).toLowerCase();
  const params = (`0x${data.slice(10)}` as Hex).toLowerCase() as Hex;

  try {
    if (selector === ERC20_TRANSFER_SELECTOR) {
      const [, amount] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        params,
      );
      return amount;
    }

    if (selector === ERC20_TRANSFER_FROM_SELECTOR) {
      const [, , amount] = decodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        params,
      );
      return amount;
    }
  } catch {
    return null;
  }

  return null;
}

function validateAction(
  delegation: Delegation,
  action: AgentAction,
): ValidationResult {
  for (const caveat of delegation.caveats) {
    const ct = decodeCaveatType(caveat.enforcer);

    switch (ct) {
      case CaveatType.SpendingLimit: {
        const [maxTx, maxDay] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          caveat.terms,
        );
        if (action.value > maxTx) {
          return {
            allowed: false,
            reason: `Value ${action.value} exceeds per-tx limit ${maxTx}`,
          };
        }
        const record = trackSpending(delegation);
        if (record.totalSpent + action.value > maxDay) {
          return {
            allowed: false,
            reason: `Cumulative spend would exceed daily limit ${maxDay}`,
          };
        }
        break;
      }
      case CaveatType.TimeBound: {
        const [from, until] = decodeAbiParameters(
          [{ type: "uint128" }, { type: "uint128" }],
          caveat.terms,
        );
        const now = Math.floor(Date.now() / 1000);
        if (now < Number(from)) {
          return { allowed: false, reason: "Delegation not yet active" };
        }
        if (now > Number(until)) {
          return { allowed: false, reason: "Delegation has expired" };
        }
        break;
      }
      case CaveatType.ContractTarget: {
        const [targets] = decodeAbiParameters(
          [{ type: "address[]" }],
          caveat.terms,
        );
        const lower = (targets as string[]).map((t) => t.toLowerCase());
        if (!lower.includes(action.to.toLowerCase())) {
          return {
            allowed: false,
            reason: `Target ${action.to} is not in allowed list`,
          };
        }
        break;
      }
      case CaveatType.TokenAllowance: {
        const [token, allowance] = decodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          caveat.terms,
        );

        // Only enforce token allowance for ERC-20 transfer/transferFrom actions
        // to the token contract. Non-token actions (e.g. ETH transfer with 0x
        // calldata) must not be blocked by this caveat.
        if ((token as string).toLowerCase() !== action.to.toLowerCase()) break;

        const tokenAmount = decodeErc20AmountFromCalldata(action.data);
        if (tokenAmount === null) break;

        if (tokenAmount > allowance) {
          return {
            allowed: false,
            reason: `Token transfer amount ${tokenAmount} exceeds token allowance ${allowance}`,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/*  executeWithinDelegation                                           */
/* ------------------------------------------------------------------ */

export interface ExecutionResult {
  success: boolean;
  action: AgentAction;
  validation: ValidationResult;
  simulatedTxHash?: string;
}

/**
 * Validate an action against delegation caveats and (simulated) execute it.
 * In production this would submit to the DelegationManager on-chain.
 */
export function executeWithinDelegation(
  delegation: Delegation,
  action: AgentAction,
): ExecutionResult {
  const validation = validateAction(delegation, action);

  if (!validation.allowed) {
    return { success: false, action, validation };
  }

  // Record spending
  const record = trackSpending(delegation);
  record.totalSpent += action.value;
  record.transactions.push({
    value: action.value,
    timestamp: Math.floor(Date.now() / 1000),
  });

  // Simulated tx hash (deterministic for tests)
  const simulatedTxHash = `0x${Buffer.from(
    `${delegation.salt}${action.to}${action.value}`,
  )
    .toString("hex")
    .slice(0, 64)
    .padEnd(64, "0")}`;

  return { success: true, action, validation, simulatedTxHash };
}
