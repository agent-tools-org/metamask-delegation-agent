import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileSolidity, compileAndWrite } from "../src/compile.js";

const CONTRACT_PATH = path.resolve("contracts/DelegationRegistry.sol");
const TMP_OUT = path.resolve("test/__artifacts_tmp");

describe("compile", () => {
  afterAll(() => {
    fs.rmSync(TMP_OUT, { recursive: true, force: true });
  });

  it("compiles DelegationRegistry.sol and returns ABI + bytecode", () => {
    const results = compileSolidity(CONTRACT_PATH);
    expect(results).toHaveLength(1);
    expect(results[0].contractName).toBe("DelegationRegistry");
    expect(results[0].abi.length).toBeGreaterThan(0);
    expect(results[0].bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it("ABI contains expected function signatures", () => {
    const results = compileSolidity(CONTRACT_PATH);
    const abi = results[0].abi as { type: string; name?: string }[];
    const fnNames = abi
      .filter((e) => e.type === "function")
      .map((e) => e.name);

    expect(fnNames).toContain("createDelegation");
    expect(fnNames).toContain("revokeDelegation");
    expect(fnNames).toContain("getDelegation");
    expect(fnNames).toContain("getDelegationCount");
    expect(fnNames).toContain("isActive");
  });

  it("ABI contains expected events", () => {
    const results = compileSolidity(CONTRACT_PATH);
    const abi = results[0].abi as { type: string; name?: string }[];
    const eventNames = abi
      .filter((e) => e.type === "event")
      .map((e) => e.name);

    expect(eventNames).toContain("DelegationCreated");
    expect(eventNames).toContain("DelegationRevoked");
  });

  it("compileAndWrite writes artifact JSON to disk", () => {
    const written = compileAndWrite(CONTRACT_PATH, TMP_OUT);
    expect(written).toHaveLength(1);
    expect(fs.existsSync(written[0])).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(written[0], "utf-8"));
    expect(artifact.contractName).toBe("DelegationRegistry");
    expect(artifact.abi).toBeDefined();
    expect(artifact.bytecode).toMatch(/^0x/);
  });

  it("throws on invalid Solidity source", () => {
    const badPath = path.resolve("test/__bad_contract.sol");
    fs.writeFileSync(badPath, "this is not valid solidity code!!!");
    try {
      expect(() => compileSolidity(badPath)).toThrow(
        "Solidity compilation failed",
      );
    } finally {
      fs.unlinkSync(badPath);
    }
  });
});
