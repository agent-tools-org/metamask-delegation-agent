import { describe, it, expect, beforeEach } from "vitest";
import type { Address, Hex } from "viem";
import { buildDelegation } from "../src/delegation/builder.js";
import { CaveatType, type AgentAction } from "../src/delegation/types.js";
import {
  checkPermissions,
  executeWithinDelegation,
  trackSpending,
  resetSpendingLedger,
} from "../src/agent/delegated-agent.js";

const DELEGATE: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const UNISWAP: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const UNAUTHORISED: Address = "0xdead000000000000000000000000000000000000";

beforeEach(() => resetSpendingLedger());

describe("checkPermissions", () => {
  it("returns spending-limit permission", () => {
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
    const perms = checkPermissions(d);
    expect(perms).toHaveLength(1);
    expect(perms[0].type).toBe(CaveatType.SpendingLimit);
  });

  it("returns all permission types for multi-caveat delegation", () => {
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
        { type: CaveatType.TimeBound, validFrom: now - 60, validUntil: now + 3600 },
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    const types = checkPermissions(d).map((p) => p.type);
    expect(types).toContain(CaveatType.SpendingLimit);
    expect(types).toContain(CaveatType.TimeBound);
    expect(types).toContain(CaveatType.ContractTarget);
  });
});

describe("executeWithinDelegation", () => {
  it("allows action within all bounds", () => {
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
        { type: CaveatType.TimeBound, validFrom: now - 60, validUntil: now + 3600 },
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    const action: AgentAction = {
      to: UNISWAP,
      value: BigInt(5e15),
      data: "0x" as Hex,
    };
    const result = executeWithinDelegation(d, action);
    expect(result.success).toBe(true);
    expect(result.simulatedTxHash).toBeDefined();
  });

  it("blocks action exceeding per-tx spending limit", () => {
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
        { type: CaveatType.TimeBound, validFrom: now - 60, validUntil: now + 3600 },
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
      ],
    });
    const action: AgentAction = {
      to: UNISWAP,
      value: BigInt(2e16), // exceeds 1e16
      data: "0x" as Hex,
    };
    const result = executeWithinDelegation(d, action);
    expect(result.success).toBe(false);
    expect(result.validation.reason).toMatch(/per-tx limit/);
  });

  it("blocks action to unauthorised contract", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        { type: CaveatType.ContractTarget, allowedTargets: [UNISWAP] },
        { type: CaveatType.TimeBound, validFrom: now - 60, validUntil: now + 3600 },
      ],
    });
    const action: AgentAction = {
      to: UNAUTHORISED,
      value: BigInt(0),
      data: "0x" as Hex,
    };
    const result = executeWithinDelegation(d, action);
    expect(result.success).toBe(false);
    expect(result.validation.reason).toMatch(/not in allowed list/);
  });
});

describe("trackSpending", () => {
  it("initialises at zero and accumulates", () => {
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
    const record = trackSpending(d);
    expect(record.totalSpent).toBe(BigInt(0));

    // Execute a valid action
    executeWithinDelegation(d, {
      to: DELEGATE, // no contract-target caveat, so any target OK
      value: BigInt(5e15),
      data: "0x" as Hex,
    });

    const updated = trackSpending(d);
    expect(updated.totalSpent).toBe(BigInt(5e15));
    expect(updated.transactions).toHaveLength(1);
  });

  it("blocks when cumulative spend exceeds daily limit", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(6e16),
          maxPerDay: BigInt(1e17), // 0.1 ETH
        },
      ],
    });

    // First action: 0.06 ETH — OK
    const r1 = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(6e16),
      data: "0x" as Hex,
    });
    expect(r1.success).toBe(true);

    // Second action: 0.06 ETH — cumulative 0.12 > 0.1 daily limit
    const r2 = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(6e16),
      data: "0x" as Hex,
    });
    expect(r2.success).toBe(false);
    expect(r2.validation.reason).toMatch(/daily limit/);
  });

  it("blocks action on an expired delegation", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.TimeBound,
          validFrom: now - 7200,
          validUntil: now - 3600, // expired 1 hour ago
        },
      ],
    });
    const result = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(1000),
      data: "0x" as Hex,
    });
    expect(result.success).toBe(false);
    expect(result.validation.reason).toMatch(/expired/);
  });

  it("allows action exactly at per-tx spending limit (boundary)", () => {
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
    // Value exactly equals per-tx limit
    const result = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(1e16),
      data: "0x" as Hex,
    });
    expect(result.success).toBe(true);
  });

  it("accumulates multiple spends up to exactly the daily limit", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.SpendingLimit,
          maxPerTransaction: BigInt(5e16),
          maxPerDay: BigInt(1e17), // 0.1 ETH
        },
      ],
    });

    // Two actions of 0.05 ETH each = exactly 0.1 ETH daily limit
    const r1 = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(5e16),
      data: "0x" as Hex,
    });
    expect(r1.success).toBe(true);

    const r2 = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(5e16),
      data: "0x" as Hex,
    });
    expect(r2.success).toBe(true);

    // Third action of any amount should fail
    const r3 = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(1),
      data: "0x" as Hex,
    });
    expect(r3.success).toBe(false);
    expect(r3.validation.reason).toMatch(/daily limit/);
  });

  it("blocks action on a delegation not yet active", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.TimeBound,
          validFrom: now + 3600, // starts in 1 hour
          validUntil: now + 7200,
        },
      ],
    });
    const result = executeWithinDelegation(d, {
      to: DELEGATE,
      value: BigInt(0),
      data: "0x" as Hex,
    });
    expect(result.success).toBe(false);
    expect(result.validation.reason).toMatch(/not yet active/);
  });
});
