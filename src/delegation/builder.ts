import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import {
  type Delegation,
  type Caveat,
  type CaveatParams,
  CaveatType,
  type SpendingLimitParams,
  type TimeBoundParams,
  type ContractTargetParams,
  type TokenAllowanceParams,
} from "./types.js";
import { DELEGATION_FRAMEWORK } from "../config.js";

/* ------------------------------------------------------------------ */
/*  Caveat encoding helpers                                           */
/* ------------------------------------------------------------------ */

function encodeSpendingLimit(params: SpendingLimitParams): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [params.maxPerTransaction, params.maxPerDay],
  );
}

function encodeTimeBound(params: TimeBoundParams): Hex {
  return encodeAbiParameters(
    [{ type: "uint128" }, { type: "uint128" }],
    [BigInt(params.validFrom), BigInt(params.validUntil)],
  );
}

function encodeContractTarget(params: ContractTargetParams): Hex {
  return encodeAbiParameters(
    [{ type: "address[]" }],
    [params.allowedTargets],
  );
}

function encodeTokenAllowance(params: TokenAllowanceParams): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [params.token, params.allowance],
  );
}

/* ------------------------------------------------------------------ */
/*  Enforcer address lookup                                           */
/* ------------------------------------------------------------------ */

function enforcerFor(caveatType: CaveatType): Address {
  switch (caveatType) {
    case CaveatType.SpendingLimit:
      return DELEGATION_FRAMEWORK.spendingLimitEnforcer;
    case CaveatType.TimeBound:
      return DELEGATION_FRAMEWORK.timeBoundEnforcer;
    case CaveatType.ContractTarget:
      return DELEGATION_FRAMEWORK.allowedTargetsEnforcer;
    case CaveatType.TokenAllowance:
      return DELEGATION_FRAMEWORK.erc20AllowanceEnforcer;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface BuildDelegationParams {
  delegate: Address;
  authority: Address;
  caveats?: CaveatParams[];
  salt?: Hex;
}

/** Build an unsigned Delegation from high-level parameters. */
export function buildDelegation(params: BuildDelegationParams): Delegation {
  const salt =
    params.salt ??
    keccak256(toHex(Date.now().toString() + Math.random().toString()));

  let delegation: Delegation = {
    delegate: params.delegate,
    authority: params.authority,
    caveats: [],
    salt,
    signature: "0x" as Hex,
  };

  if (params.caveats) {
    for (const cp of params.caveats) {
      delegation = addCaveat(delegation, cp);
    }
  }

  return delegation;
}

/** Append a caveat to an existing Delegation (immutable). */
export function addCaveat(
  delegation: Delegation,
  params: CaveatParams,
): Delegation {
  const caveat = encodeCaveatParams(params);
  return { ...delegation, caveats: [...delegation.caveats, caveat] };
}

/** Low-level: encode a CaveatParams into an on-chain Caveat. */
export function encodeCaveatParams(params: CaveatParams): Caveat {
  const enforcer = enforcerFor(params.type);
  let terms: Hex;

  switch (params.type) {
    case CaveatType.SpendingLimit:
      terms = encodeSpendingLimit(params);
      break;
    case CaveatType.TimeBound:
      terms = encodeTimeBound(params);
      break;
    case CaveatType.ContractTarget:
      terms = encodeContractTarget(params);
      break;
    case CaveatType.TokenAllowance:
      terms = encodeTokenAllowance(params);
      break;
  }

  return { enforcer, terms };
}

/**
 * Produce EIP-712 typed-data structure for signing a Delegation.
 * Conforms to MetaMask Delegation Toolkit's signing domain.
 */
export function encodeDelegation(delegation: Delegation) {
  return {
    domain: {
      name: "DelegationManager",
      version: "1",
      chainId: 84532,
      verifyingContract: DELEGATION_FRAMEWORK.delegationManager,
    },
    types: {
      Delegation: [
        { name: "delegate", type: "address" },
        { name: "authority", type: "address" },
        { name: "caveats", type: "Caveat[]" },
        { name: "salt", type: "bytes32" },
      ],
      Caveat: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
      ],
    },
    primaryType: "Delegation" as const,
    message: {
      delegate: delegation.delegate,
      authority: delegation.authority,
      caveats: delegation.caveats,
      salt: delegation.salt,
    },
  };
}
