import { describe, it, expect, beforeEach } from "vitest";
import type { Address, Hex } from "viem";
import { buildDelegation } from "../src/delegation/builder.js";
import { CaveatType } from "../src/delegation/types.js";
import {
  summarisePermissions,
  isDelegationValid,
  checkSpendingAlert,
} from "../src/agent/permission-manager.js";
import {
  executeWithinDelegation,
  resetSpendingLedger,
} from "../src/agent/delegated-agent.js";

const DELEGATE: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const UNISWAP: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

beforeEach(() => resetSpendingLedger());

describe("summarisePermissions", () => {
  it("produces human-readable summary for spending limit", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt("10000000000000000"),
          maxPerDay: BigInt("100000000000000000"),
        },
      ],
    });
    const s = summarisePermissions(d);
    expect(s).toContain("This agent can:");
    expect(s).toContain("0.01 ETH/tx");
    expect(s).toContain("0.1 ETH/day");
  });

  it("includes contract targets in summary", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    const s = summarisePermissions(d);
    expect(s).toContain("only interact with");
  });

  it("returns no-constraint message for empty caveats", () => {
    const d = buildDelegation({ delegate: DELEGATE, authority: AUTHORITY });
    expect(summarisePermissions(d)).toContain("no constrained permissions");
  });
});

describe("isDelegationValid", () => {
  it("returns true for currently active time-bound delegation", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.TimeBound, validFrom: now - 60, validUntil: now + 3600 },
      ],
    });
    expect(isDelegationValid(d)).toBe(true);
  });

  it("returns false for expired delegation", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.TimeBound, validFrom: now - 7200, validUntil: now - 3600 },
      ],
    });
    expect(isDelegationValid(d)).toBe(false);
  });
});

describe("checkSpendingAlert", () => {
  it("returns no alert when spending is low", () => {
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
    const alert = checkSpendingAlert(d);
    expect(alert.nearLimit).toBe(false);
    expect(alert.percentUsed).toBe(0);
  });

  it("alerts when spending exceeds 80%", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(9e16),
          maxPerDay: BigInt(1e17), // 0.1 ETH
        },
      ],
    });

    // Spend 0.085 ETH (85% of daily limit)
    executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(85e15),
      data: "0x" as Hex,
    });

    const alert = checkSpendingAlert(d);
    expect(alert.nearLimit).toBe(true);
    expect(alert.percentUsed).toBeGreaterThanOrEqual(80);
    expect(alert.message).toContain("⚠️");
  });
});
