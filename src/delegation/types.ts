import type { Address, Hex } from "viem";

/** Caveat enforcer categories supported by the toolkit */
export enum CaveatType {
  SpendingLimit = "SpendingLimit",
  TimeBound = "TimeBound",
  ContractTarget = "ContractTarget",
  TokenAllowance = "TokenAllowance",
}

/** A single caveat attached to a delegation */
export interface Caveat {
  /** Address of the on-chain enforcer contract */
  enforcer: Address;
  /** ABI-encoded parameters for the enforcer */
  terms: Hex;
}

/**
 * ERC-7710 Delegation object.
 * Grants a `delegate` a scoped set of permissions under `authority`.
 */
export interface Delegation {
  /** Address that receives the delegated permissions */
  delegate: Address;
  /** Root authority (delegator) address */
  authority: Address;
  /** Ordered list of caveat enforcers that constrain the delegation */
  caveats: Caveat[];
  /** Unique salt to avoid replay */
  salt: Hex;
  /** EIP-712 signature from the authority */
  signature: Hex;
}

/** Parameters for building a spending-limit caveat */
export interface SpendingLimitParams {
  type: CaveatType.SpendingLimit;
  /** Maximum wei per individual transaction */
  maxPerTransaction: bigint;
  /** Maximum cumulative wei per 24-hour rolling window */
  maxPerDay: bigint;
}

/** Parameters for building a time-bound caveat */
export interface TimeBoundParams {
  type: CaveatType.TimeBound;
  /** Unix timestamp (seconds) — delegation is invalid before this */
  validFrom: number;
  /** Unix timestamp (seconds) — delegation expires after this */
  validUntil: number;
}

/** Parameters for building a contract-target caveat */
export interface ContractTargetParams {
  type: CaveatType.ContractTarget;
  /** Whitelisted contract addresses the delegate may call */
  allowedTargets: Address[];
}

/** Parameters for building a token-allowance caveat */
export interface TokenAllowanceParams {
  type: CaveatType.TokenAllowance;
  /** ERC-20 token contract address */
  token: Address;
  /** Maximum token units (in smallest denomination) the delegate may spend */
  allowance: bigint;
}

/** Union of all caveat parameter types */
export type CaveatParams =
  | SpendingLimitParams
  | TimeBoundParams
  | ContractTargetParams
  | TokenAllowanceParams;

/** Describes an action the agent wants to execute */
export interface AgentAction {
  /** Target contract address */
  to: Address;
  /** ETH value in wei */
  value: bigint;
  /** Calldata */
  data: Hex;
  /** Optional human-readable description */
  description?: string;
}
