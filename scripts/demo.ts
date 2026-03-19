import { mkdirSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { buildDelegation, encodeDelegation } from "../src/delegation/builder.js";
import { CaveatType, type AgentAction } from "../src/delegation/types.js";
import {
  checkPermissions,
  executeWithinDelegation,
  resetSpendingLedger,
} from "../src/agent/delegated-agent.js";
import {
  summarisePermissions,
  isDelegationValid,
  checkSpendingAlert,
} from "../src/agent/permission-manager.js";

/* ------------------------------------------------------------------ */
/*  Demo constants                                                    */
/* ------------------------------------------------------------------ */

const AGENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const UNISWAP: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const UNAUTHORISED: Address = "0xdead000000000000000000000000000000000000";

/* ------------------------------------------------------------------ */
/*  Run                                                               */
/* ------------------------------------------------------------------ */

function run() {
  resetSpendingLedger();
  const now = Math.floor(Date.now() / 1000);

  // 1️⃣ Build delegation
  const delegation = buildDelegation({
    delegate: AGENT,
    authority: AUTHORITY,
    caveats: [
      {
        type: CaveatType.SpendingLimit,
        maxPerTransaction: BigInt("10000000000000000"),
        maxPerDay: BigInt("100000000000000000"),
      },
      {
        type: CaveatType.TimeBound,
        validFrom: now - 3600,
        validUntil: now + 86400 * 30,
      },
      {
        type: CaveatType.ContractTarget,
        allowedTargets: [UNISWAP],
      },
    ],
  });

  // 2️⃣ Inspect
  const permissions = checkPermissions(delegation);
  const summary = summarisePermissions(delegation);
  const valid = isDelegationValid(delegation);
  const typedData = encodeDelegation(delegation);

  // 3️⃣ Simulate good action
  const goodAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("5000000000000000"),
    data: "0x" as Hex,
    description: "Swap 0.005 ETH on Uniswap",
  };
  const goodResult = executeWithinDelegation(delegation, goodAction);

  // 4️⃣ Simulate bad action (wrong target)
  const badAction: AgentAction = {
    to: UNAUTHORISED,
    value: BigInt("5000000000000000"),
    data: "0x" as Hex,
    description: "Call unauthorised contract",
  };
  const badResult = executeWithinDelegation(delegation, badAction);

  // 5️⃣ Simulate over-limit action
  const overLimitAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("20000000000000000"),
    data: "0x" as Hex,
    description: "Attempt to spend 0.02 ETH (exceeds per-tx limit of 0.01 ETH)",
  };
  const overLimitResult = executeWithinDelegation(delegation, overLimitAction);

  // 6️⃣ Spending alert
  const spendingAlert = checkSpendingAlert(delegation);

  // Assemble proof
  const proof = {
    timestamp: new Date().toISOString(),
    chain: "Base Sepolia (84532)",
    delegation: {
      delegate: delegation.delegate,
      authority: delegation.authority,
      caveatsCount: delegation.caveats.length,
      salt: delegation.salt,
    },
    permissions: permissions.map((p) => ({
      type: p.type,
      description: p.description,
    })),
    summary,
    valid,
    eip712Domain: typedData.domain,
    simulations: [
      {
        description: goodAction.description,
        allowed: goodResult.success,
        reason: goodResult.validation.reason ?? "within bounds",
        txHash: goodResult.simulatedTxHash ?? null,
      },
      {
        description: badAction.description,
        allowed: badResult.success,
        reason: badResult.validation.reason ?? "within bounds",
        txHash: badResult.simulatedTxHash ?? null,
      },
      {
        description: overLimitAction.description,
        allowed: overLimitResult.success,
        reason: overLimitResult.validation.reason ?? "within bounds",
        txHash: overLimitResult.simulatedTxHash ?? null,
      },
    ],
    spendingAlert: {
      nearLimit: spendingAlert.nearLimit,
      percentUsed: spendingAlert.percentUsed,
      message: spendingAlert.message,
    },
  };

  // Write proof
  mkdirSync("proof", { recursive: true });
  writeFileSync("proof/demo.json", JSON.stringify(proof, null, 2) + "\n");

  console.log("✅ Demo complete — proof written to proof/demo.json");
  console.log(JSON.stringify(proof, null, 2));
}

run();
