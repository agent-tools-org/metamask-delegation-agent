import { mkdirSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { buildDelegation, addCaveat, encodeDelegation } from "../src/delegation/builder.js";
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
/*  Colour helpers                                                    */
/* ------------------------------------------------------------------ */

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgRed: "\x1b[41m\x1b[37m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgYellow: "\x1b[43m\x1b[30m",
  bgMagenta: "\x1b[45m\x1b[37m",
};

function header(title: string) {
  const line = "═".repeat(60);
  console.log(`\n${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.cyan}${line}${C.reset}\n`);
}

function subHeader(title: string) {
  console.log(`\n  ${C.bold}${C.blue}▸ ${title}${C.reset}`);
}

function ok(msg: string) {
  console.log(`  ${C.green}✅ ${msg}${C.reset}`);
}

function fail(msg: string) {
  console.log(`  ${C.red}❌ ${msg}${C.reset}`);
}

function info(msg: string) {
  console.log(`  ${C.dim}${msg}${C.reset}`);
}

function warn(msg: string) {
  console.log(`  ${C.yellow}⚠️  ${msg}${C.reset}`);
}

/* ------------------------------------------------------------------ */
/*  Demo constants                                                    */
/* ------------------------------------------------------------------ */

const AGENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SUB_AGENT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const AUTHORITY: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const UNISWAP: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const AAVE: Address = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const UNAUTHORISED: Address = "0xdead000000000000000000000000000000000000";

/* ------------------------------------------------------------------ */
/*  Run                                                               */
/* ------------------------------------------------------------------ */

function run() {
  resetSpendingLedger();
  const now = Math.floor(Date.now() / 1000);
  const allSimulations: Record<string, unknown>[] = [];

  // ================================================================
  //  SCENARIO 1: Delegation with multiple caveats
  // ================================================================
  header("SCENARIO 1 — Delegation with Multiple Caveats");

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
        allowedTargets: [UNISWAP, AAVE],
      },
    ],
  });

  const permissions = checkPermissions(delegation);
  const summary = summarisePermissions(delegation);
  const valid = isDelegationValid(delegation);
  const typedData = encodeDelegation(delegation);

  subHeader("Delegation created with 3 caveat types");
  info(`Delegate:  ${delegation.delegate}`);
  info(`Authority: ${delegation.authority}`);
  info(`Caveats:   ${delegation.caveats.length}`);
  info(`Valid:     ${valid}`);
  info(`Summary:   ${summary}`);
  permissions.forEach((p) => info(`  • [${p.type}] ${p.description}`));

  // Good action — swap on Uniswap
  subHeader("Action: Swap 0.005 ETH on Uniswap");
  const goodAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("5000000000000000"),
    data: "0x" as Hex,
    description: "Swap 0.005 ETH on Uniswap",
  };
  const goodResult = executeWithinDelegation(delegation, goodAction);
  if (goodResult.success) {
    ok(`Allowed — tx ${goodResult.simulatedTxHash?.slice(0, 18)}…`);
  } else {
    fail(`Blocked — ${goodResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 1,
    description: goodAction.description,
    allowed: goodResult.success,
    reason: goodResult.validation.reason ?? "within bounds",
  });

  // Good action — interact with Aave (second target)
  subHeader("Action: Interact with Aave (second whitelisted target)");
  const aaveAction: AgentAction = {
    to: AAVE,
    value: BigInt("3000000000000000"),
    data: "0x" as Hex,
    description: "Deposit 0.003 ETH on Aave",
  };
  const aaveResult = executeWithinDelegation(delegation, aaveAction);
  if (aaveResult.success) {
    ok(`Allowed — tx ${aaveResult.simulatedTxHash?.slice(0, 18)}…`);
  } else {
    fail(`Blocked — ${aaveResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 1,
    description: aaveAction.description,
    allowed: aaveResult.success,
    reason: aaveResult.validation.reason ?? "within bounds",
  });

  // Bad action — wrong target
  subHeader("Action: Call unauthorised contract");
  const badAction: AgentAction = {
    to: UNAUTHORISED,
    value: BigInt("5000000000000000"),
    data: "0x" as Hex,
    description: "Call unauthorised contract",
  };
  const badResult = executeWithinDelegation(delegation, badAction);
  if (badResult.success) {
    ok(`Allowed — tx ${badResult.simulatedTxHash?.slice(0, 18)}…`);
  } else {
    fail(`Blocked — ${badResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 1,
    description: badAction.description,
    allowed: badResult.success,
    reason: badResult.validation.reason ?? "within bounds",
  });

  // Over-limit action
  subHeader("Action: Attempt 0.02 ETH (exceeds 0.01 ETH per-tx limit)");
  const overLimitAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("20000000000000000"),
    data: "0x" as Hex,
    description: "Attempt to spend 0.02 ETH (exceeds per-tx limit)",
  };
  const overLimitResult = executeWithinDelegation(delegation, overLimitAction);
  if (overLimitResult.success) {
    ok(`Allowed — tx ${overLimitResult.simulatedTxHash?.slice(0, 18)}…`);
  } else {
    fail(`Blocked — ${overLimitResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 1,
    description: overLimitAction.description,
    allowed: overLimitResult.success,
    reason: overLimitResult.validation.reason ?? "within bounds",
  });

  // Spending alert
  const alert1 = checkSpendingAlert(delegation);
  info(`\n  Spending alert: ${alert1.message} (${alert1.percentUsed.toFixed(1)}%)`);

  // ================================================================
  //  SCENARIO 2: Delegation chain (sub-delegation)
  // ================================================================
  header("SCENARIO 2 — Delegation Chain (Sub-delegation)");
  resetSpendingLedger();

  info("The primary agent creates a sub-delegation with tighter constraints.");
  info("This demonstrates composable, hierarchical permission scoping.\n");

  // Primary delegation: agent gets broad permissions
  const primaryDelegation = buildDelegation({
    delegate: AGENT,
    authority: AUTHORITY,
    caveats: [
      {
        type: CaveatType.SpendingLimit,
        maxPerTransaction: BigInt("10000000000000000"),   // 0.01 ETH
        maxPerDay: BigInt("100000000000000000"),           // 0.1 ETH
      },
      {
        type: CaveatType.ContractTarget,
        allowedTargets: [UNISWAP, AAVE],
      },
    ],
  });

  subHeader("Primary delegation: Agent ← Authority");
  info(`Delegate:  ${AGENT}`);
  info(`Authority: ${AUTHORITY}`);
  info(`Summary:   ${summarisePermissions(primaryDelegation)}`);

  // Sub-delegation: agent delegates to sub-agent with TIGHTER limits
  const subDelegation = buildDelegation({
    delegate: SUB_AGENT,
    authority: AGENT, // the primary agent is now the authority
    caveats: [
      {
        type: CaveatType.SpendingLimit,
        maxPerTransaction: BigInt("5000000000000000"),     // 0.005 ETH (tighter)
        maxPerDay: BigInt("20000000000000000"),             // 0.02 ETH (tighter)
      },
      {
        type: CaveatType.ContractTarget,
        allowedTargets: [UNISWAP], // only Uniswap (subset of parent)
      },
    ],
  });

  subHeader("Sub-delegation: Sub-Agent ← Agent");
  info(`Delegate:  ${SUB_AGENT}`);
  info(`Authority: ${AGENT}`);
  info(`Summary:   ${summarisePermissions(subDelegation)}`);

  // Sub-agent executes within its tighter scope
  subHeader("Sub-agent action: Swap 0.004 ETH on Uniswap");
  const subAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("4000000000000000"),
    data: "0x" as Hex,
    description: "Sub-agent: Swap 0.004 ETH on Uniswap",
  };
  const subResult = executeWithinDelegation(subDelegation, subAction);
  if (subResult.success) {
    ok(`Allowed — sub-agent operated within tighter scope`);
  } else {
    fail(`Blocked — ${subResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 2,
    description: subAction.description,
    allowed: subResult.success,
    reason: subResult.validation.reason ?? "within bounds",
  });

  // Sub-agent tries to exceed its own (tighter) per-tx limit
  subHeader("Sub-agent action: Attempt 0.008 ETH (exceeds sub-delegation limit)");
  const subOverAction: AgentAction = {
    to: UNISWAP,
    value: BigInt("8000000000000000"),
    data: "0x" as Hex,
    description: "Sub-agent: Attempt 0.008 ETH (exceeds sub per-tx limit)",
  };
  const subOverResult = executeWithinDelegation(subDelegation, subOverAction);
  if (subOverResult.success) {
    ok(`Allowed`);
  } else {
    fail(`Blocked — ${subOverResult.validation.reason}`);
  }
  allSimulations.push({
    scenario: 2,
    description: subOverAction.description,
    allowed: subOverResult.success,
    reason: subOverResult.validation.reason ?? "within bounds",
  });

  // ================================================================
  //  SCENARIO 3: Permission escalation attempt (blocked)
  // ================================================================
  header("SCENARIO 3 — Permission Escalation Attempt (Blocked)");
  resetSpendingLedger();

  info("An agent tries to interact outside its granted scope.");
  info("Every action is validated against the delegation's caveats.\n");

  const restrictedDelegation = buildDelegation({
    delegate: AGENT,
    authority: AUTHORITY,
    caveats: [
      {
        type: CaveatType.SpendingLimit,
        maxPerTransaction: BigInt("1000000000000000"),    // 0.001 ETH
        maxPerDay: BigInt("5000000000000000"),              // 0.005 ETH
      },
      {
        type: CaveatType.ContractTarget,
        allowedTargets: [UNISWAP],
      },
      {
        type: CaveatType.TimeBound,
        validFrom: now - 60,
        validUntil: now + 3600,
      },
    ],
  });

  subHeader("Restricted delegation created");
  info(`Summary: ${summarisePermissions(restrictedDelegation)}`);

  // Attempt 1: Call a contract outside the whitelist
  subHeader("Escalation attempt: Call Aave (not in whitelist)");
  const escAction1: AgentAction = {
    to: AAVE,
    value: BigInt("500000000000000"),
    data: "0x" as Hex,
    description: "Escalation: call Aave (not whitelisted)",
  };
  const escResult1 = executeWithinDelegation(restrictedDelegation, escAction1);
  if (escResult1.success) {
    ok(`Allowed`);
  } else {
    fail(`Blocked — ${escResult1.validation.reason}`);
  }
  allSimulations.push({
    scenario: 3,
    description: escAction1.description,
    allowed: escResult1.success,
    reason: escResult1.validation.reason ?? "within bounds",
  });

  // Attempt 2: Spend more than per-tx limit
  subHeader("Escalation attempt: Spend 0.01 ETH (10x the per-tx limit)");
  const escAction2: AgentAction = {
    to: UNISWAP,
    value: BigInt("10000000000000000"),
    data: "0x" as Hex,
    description: "Escalation: spend 0.01 ETH (10x per-tx limit)",
  };
  const escResult2 = executeWithinDelegation(restrictedDelegation, escAction2);
  if (escResult2.success) {
    ok(`Allowed`);
  } else {
    fail(`Blocked — ${escResult2.validation.reason}`);
  }
  allSimulations.push({
    scenario: 3,
    description: escAction2.description,
    allowed: escResult2.success,
    reason: escResult2.validation.reason ?? "within bounds",
  });

  // Attempt 3: Exhaust the daily limit with repeated small spends
  subHeader("Escalation attempt: Exhaust daily limit with 6 × 0.001 ETH");
  let exhaustCount = 0;
  for (let i = 0; i < 6; i++) {
    const r = executeWithinDelegation(restrictedDelegation, {
      to: UNISWAP,
      value: BigInt("1000000000000000"),
      data: "0x" as Hex,
    });
    if (r.success) {
      exhaustCount++;
    } else {
      fail(`Blocked on tx #${i + 1} — ${r.validation.reason}`);
      allSimulations.push({
        scenario: 3,
        description: `Exhaust daily limit: tx #${i + 1} of 6`,
        allowed: false,
        reason: r.validation.reason ?? "limit reached",
      });
      break;
    }
  }
  if (exhaustCount > 0) {
    ok(`${exhaustCount} transactions succeeded before daily cap was hit`);
  }

  const alert3 = checkSpendingAlert(restrictedDelegation);
  warn(`Spending alert: ${alert3.message}`);

  // ================================================================
  //  SUMMARY
  // ================================================================
  header("DEMO COMPLETE");

  // Assemble proof
  const proof = {
    timestamp: new Date().toISOString(),
    chain: "Base Sepolia (84532)",
    scenarios: [
      {
        name: "Multiple Caveats",
        delegation: {
          delegate: delegation.delegate,
          authority: delegation.authority,
          caveatsCount: delegation.caveats.length,
        },
        summary: summarisePermissions(delegation),
      },
      {
        name: "Delegation Chain (Sub-delegation)",
        primary: {
          delegate: primaryDelegation.delegate,
          authority: primaryDelegation.authority,
        },
        sub: {
          delegate: subDelegation.delegate,
          authority: subDelegation.authority,
        },
      },
      {
        name: "Permission Escalation (Blocked)",
        delegation: {
          delegate: restrictedDelegation.delegate,
          caveatsCount: restrictedDelegation.caveats.length,
        },
      },
    ],
    eip712Domain: typedData.domain,
    simulations: allSimulations,
  };

  // Write proof
  mkdirSync("proof", { recursive: true });
  writeFileSync("proof/demo.json", JSON.stringify(proof, null, 2) + "\n");

  ok(`Proof written to ${C.bold}proof/demo.json${C.reset}`);
  info(`Total simulations: ${allSimulations.length}`);
  info(`Allowed: ${allSimulations.filter((s) => s.allowed).length}`);
  info(`Blocked: ${allSimulations.filter((s) => !s.allowed).length}`);
}

run();
