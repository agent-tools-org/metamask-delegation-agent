import type { Address, Hex } from "viem";
import { DEFAULT_CHAIN, DELEGATION_FRAMEWORK } from "./config.js";
import { buildDelegation, encodeDelegation } from "./delegation/builder.js";
import { CaveatType, type AgentAction } from "./delegation/types.js";
import {
  checkPermissions,
  executeWithinDelegation,
  resetSpendingLedger,
} from "./agent/delegated-agent.js";
import {
  summarisePermissions,
  isDelegationValid,
  checkSpendingAlert,
} from "./agent/permission-manager.js";

const AGENT_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const AUTHORITY = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const UNISWAP_ROUTER =
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD" as Address;

async function main() {
  console.log(`\n🔗 MetaMask Delegation Agent — ${DEFAULT_CHAIN.name}\n`);
  console.log("Framework addresses:");
  for (const [k, v] of Object.entries(DELEGATION_FRAMEWORK)) {
    console.log(`  ${k}: ${v}`);
  }

  // 1. Build a delegation with spending limit + time bound + contract target
  resetSpendingLedger();
  const now = Math.floor(Date.now() / 1000);

  const delegation = buildDelegation({
    delegate: AGENT_ADDRESS,
    authority: AUTHORITY,
    caveats: [
      {
        type: CaveatType.SpendingLimit,
        maxPerTransaction: BigInt("10000000000000000"), // 0.01 ETH
        maxPerDay: BigInt("100000000000000000"), // 0.1 ETH
      },
      {
        type: CaveatType.TimeBound,
        validFrom: now - 3600,
        validUntil: now + 86400 * 30,
      },
      {
        type: CaveatType.ContractTarget,
        allowedTargets: [UNISWAP_ROUTER],
      },
    ],
  });

  // 2. Inspect permissions
  console.log("\n📋 Delegation permissions:");
  const perms = checkPermissions(delegation);
  perms.forEach((p) => console.log(`  • ${p.description}`));

  console.log(`\n📝 Summary: ${summarisePermissions(delegation)}`);
  console.log(`   Valid: ${isDelegationValid(delegation)}`);

  // 3. EIP-712 typed data
  const typedData = encodeDelegation(delegation);
  console.log(
    "\n🔏 EIP-712 typed data domain:",
    JSON.stringify(typedData.domain, null, 2),
  );

  // 4. Execute within bounds (should succeed)
  const goodAction: AgentAction = {
    to: UNISWAP_ROUTER,
    value: BigInt("5000000000000000"), // 0.005 ETH
    data: "0x" as Hex,
    description: "Swap 0.005 ETH on Uniswap",
  };

  const result1 = executeWithinDelegation(delegation, goodAction);
  console.log("\n✅ Action within bounds:", result1.success, result1.validation);

  // 5. Execute outside bounds (should fail)
  const badAction: AgentAction = {
    to: "0xdead000000000000000000000000000000000000" as Address,
    value: BigInt("5000000000000000"),
    data: "0x" as Hex,
    description: "Call unauthorized contract",
  };

  const result2 = executeWithinDelegation(delegation, badAction);
  console.log("❌ Action out of bounds:", result2.success, result2.validation);

  // 6. Spending alert
  console.log("\n💰 Spending status:", checkSpendingAlert(delegation));
}

main().catch(console.error);
