import { describe, it, expect, beforeEach } from "vitest";
import type { Address, Hex } from "viem";
import { buildDelegation } from "../src/delegation/builder.js";
import { CaveatType, type AgentAction } from "../src/delegation/types.js";
import {
  executeWithinDelegation,
  resetSpendingLedger,
} from "../src/agent/delegated-agent.js";

const DELEGATE: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TOKEN: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

beforeEach(() => resetSpendingLedger());

describe("TokenAllowance bug reproduction", () => {
  it("does not block non-token actions based on token allowance", () => {
    const d = buildDelegation({
      delegate: DELEGATE,
      authority: AUTHORITY,
      caveats: [
        {
          type: CaveatType.TokenAllowance,
          token: TOKEN,
          allowance: BigInt(100), // 100 units of TOKEN
        },
      ],
    });

    // This is an ETH transfer of 1000 wei.
    // It should NOT be blocked by a TOKEN allowance caveat (unless it's a token transfer).
    const action: AgentAction = {
      to: TOKEN,
      value: BigInt(1000),
      data: "0x" as Hex,
    };

    const result = executeWithinDelegation(d, action);

    expect(result.success).toBe(true);
  });
});
