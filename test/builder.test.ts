import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import {
  buildDelegation,
  addCaveat,
  encodeDelegation,
  encodeCaveatParams,
} from "../src/delegation/builder.js";
import { CaveatType } from "../src/delegation/types.js";
import { DELEGATION_FRAMEWORK } from "../src/config.js";

const DELEGATE: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const UNISWAP: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

describe("builder", () => {
  it("builds a bare delegation with no caveats", () => {
    const d = buildDelegation({ delegate: DELEGATE, authority: AUTHORITY });
    expect(d.delegate).toBe(DELEGATE);
    expect(d.authority).toBe(AUTHORITY);
    expect(d.caveats).toHaveLength(0);
    expect(d.salt).toMatch(/^0x/);
    expect(d.signature).toBe("0x");
  });

  it("builds a delegation with a spending-limit caveat", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(1e16),
          maxPerDay: BigInt(1e17),
        },
      ],
    });
    expect(d.caveats).toHaveLength(1);
    expect(d.caveats[0].enforcer).toBe(
      DELEGATION_FRAMEWORK.spendingLimitEnforcer,
    );
  });

  it("builds a delegation with a time-bound caveat", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.TimeBound, validFrom: now, validUntil: now + 3600 },
      ],
    });
    expect(d.caveats).toHaveLength(1);
    expect(d.caveats[0].enforcer).toBe(DELEGATION_FRAMEWORK.timeBoundEnforcer);
  });

  it("builds a delegation with a contract-target caveat", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    expect(d.caveats).toHaveLength(1);
    expect(d.caveats[0].enforcer).toBe(
      DELEGATION_FRAMEWORK.allowedTargetsEnforcer,
    );
  });

  it("addCaveat appends without mutating the original", () => {
    const d1 = buildDelegation({ delegate: DELEGATE, authority: AUTHORITY });
    const d2 = addCaveat(d1, {
      type: CaveatType.SpendingLimit,
      maxPerTransaction: BigInt(1e16),
      maxPerDay: BigInt(1e17),
    });
    expect(d1.caveats).toHaveLength(0);
    expect(d2.caveats).toHaveLength(1);
  });

  it("encodeDelegation produces valid EIP-712 typed data", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(1e16),
          maxPerDay: BigInt(1e17),
        },
      ],
    });
    const typed = encodeDelegation(d);
    expect(typed.domain.name).toBe("DelegationManager");
    expect(typed.domain.chainId).toBe(84532);
    expect(typed.primaryType).toBe("Delegation");
    expect(typed.types.Delegation).toBeDefined();
    expect(typed.types.Caveat).toBeDefined();
    expect(typed.message.delegate).toBe(DELEGATE);
  });

  it("encodeCaveatParams encodes TokenAllowance correctly", () => {
    const caveat = encodeCaveatParams({
      type: CaveatType.TokenAllowance,
      token: UNISWAP,
      allowance: BigInt(1000e6),
    });
    expect(caveat.enforcer).toBe(DELEGATION_FRAMEWORK.erc20AllowanceEnforcer);
    expect(caveat.terms).toMatch(/^0x/);
  });

  it("supports multiple caveats in one delegation", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(1e16),
          maxPerDay: BigInt(1e17),
        },
        { type: CaveatType.TimeBound, validFrom: now, validUntil: now + 3600 },
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    expect(d.caveats).toHaveLength(3);
  });
});
