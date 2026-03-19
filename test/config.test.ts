import { describe, it, expect } from "vitest";
import { baseSepolia, DELEGATION_FRAMEWORK, DEFAULT_CHAIN } from "../src/config.js";

describe("config", () => {
  it("exports Base Sepolia with chain id 84532", () => {
    expect(baseSepolia.id).toBe(84532);
    expect(baseSepolia.name).toBe("Base Sepolia");
    expect(baseSepolia.testnet).toBe(true);
  });

  it("exports DEFAULT_CHAIN equal to baseSepolia", () => {
    expect(DEFAULT_CHAIN).toBe(baseSepolia);
  });

  it("exports delegation framework addresses as hex strings", () => {
    expect(DELEGATION_FRAMEWORK.delegationManager).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(DELEGATION_FRAMEWORK.spendingLimitEnforcer).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(DELEGATION_FRAMEWORK.timeBoundEnforcer).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(DELEGATION_FRAMEWORK.allowedTargetsEnforcer).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(DELEGATION_FRAMEWORK.erc20AllowanceEnforcer).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});
