![Tests](https://img.shields.io/badge/tests-36%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)
![ERC-7710](https://img.shields.io/badge/ERC--7710-delegation-purple)
![ERC-7715](https://img.shields.io/badge/ERC--7715-permissions-purple)

# MetaMask Delegation Agent

Hackathon submission for **"Best Use of Delegations"** sponsored by MetaMask ($5K prize).

An autonomous agent that operates **within scoped, user-defined permissions** using MetaMask's Delegation Toolkit (ERC-7710 / ERC-7715). The agent can spend, swap, or interact with contracts—but **only within the limits the user sets**.

---

## How It Works

The delegation flow follows five steps from permission request to on-chain enforcement:

1. **Agent requests permissions** — The agent specifies its desired capabilities via `buildDelegation()`: a spending cap, a time window, and target contracts.
2. **User reviews the scope** — `summarisePermissions()` produces a human-readable summary (e.g., *"This agent can: spend up to 0.01 ETH/tx, only on Uniswap, until March 31"*) so the user understands exactly what they're granting.
3. **User signs the delegation** — `encodeDelegation()` produces EIP-712 typed data. The user signs it with their wallet; the agent receives the signed `Delegation` object.
4. **Agent operates within bounds** — Every action goes through `executeWithinDelegation()`, which validates against **all** attached caveat enforcers before (simulated) execution.
5. **Spending is tracked & alerts fire** — `trackSpending()` keeps a running total. When cumulative spend exceeds 80% of the daily cap, `checkSpendingAlert()` returns a warning.

```
User signs delegation
        │
        ▼
┌──────────────────┐
│  buildDelegation  │  ← attach caveats (spend cap, time, targets)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ encodeDelegation  │  ← EIP-712 typed data for wallet signing
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│ executeWithinDelegation   │  ← validate action → record spend → return result
└────────┬─────────────────┘
         │
         ▼
┌──────────────────┐
│ checkSpendingAlert│  ← ⚠️ warns at 80%, ⛔ blocks at 100%
└──────────────────┘
```

---

## Example Usage

### Creating a delegation with scoped permissions

```typescript
import { buildDelegation, encodeDelegation } from "./src/delegation/builder.js";
import { CaveatType } from "./src/delegation/types.js";

const delegation = buildDelegation({
  delegate: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  authority: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  caveats: [
    {
      type: CaveatType.SpendingLimit,
      maxPerTransaction: BigInt("10000000000000000"),   // 0.01 ETH
      maxPerDay: BigInt("100000000000000000"),           // 0.1  ETH
    },
    {
      type: CaveatType.TimeBound,
      validFrom: Math.floor(Date.now() / 1000),
      validUntil: Math.floor(Date.now() / 1000) + 86400 * 30,
    },
    {
      type: CaveatType.ContractTarget,
      allowedTargets: ["0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"], // Uniswap
    },
  ],
});

// Generate EIP-712 typed data for wallet signing
const typedData = encodeDelegation(delegation);
```

### Executing an action through the agent

```typescript
import { executeWithinDelegation } from "./src/agent/delegated-agent.js";
import { summarisePermissions, checkSpendingAlert } from "./src/agent/permission-manager.js";

// Review what the delegation allows
console.log(summarisePermissions(delegation));
// → "This agent can: spend up to 0.01 ETH/tx (0.1 ETH/day), only interact with 0x3fC9…7FAD, valid from … until …"

// Execute a swap action
const result = executeWithinDelegation(delegation, {
  to: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  value: BigInt("5000000000000000"), // 0.005 ETH
  data: "0x",
});

console.log(result.success);          // true
console.log(result.simulatedTxHash);  // 0x...

// Check spending alerts
const alert = checkSpendingAlert(delegation);
console.log(alert.message);           // "✅ Spending within bounds (5.0% of daily limit used)"
```

---

## Architecture

The project is organised into three layers:

### `src/config.ts` — Chain & Contract Configuration
Exports Base Sepolia chain definition and all Delegation Framework contract addresses (DelegationManager, enforcer contracts). Configuration is loaded from environment variables with sensible defaults.

### `src/delegation/` — Delegation Building & Encoding
- **`types.ts`** — TypeScript types for `Delegation`, `Caveat`, `AgentAction`, and all caveat parameter unions (`SpendingLimitParams`, `TimeBoundParams`, `ContractTargetParams`, `TokenAllowanceParams`).
- **`builder.ts`** — Pure functions to construct delegations: `buildDelegation()` assembles a `Delegation` with encoded caveats, `addCaveat()` appends immutably, `encodeDelegation()` produces EIP-712 typed data for wallet signing.

### `src/agent/` — Agent Runtime & Permission Management
- **`delegated-agent.ts`** — Core agent logic. `checkPermissions()` introspects caveats, `executeWithinDelegation()` validates an action against every caveat then records spending, `trackSpending()` maintains a per-delegation ledger.
- **`permission-manager.ts`** — User-facing utilities. `summarisePermissions()` generates human-readable descriptions, `isDelegationValid()` checks time-bound expiry, `checkSpendingAlert()` fires warnings at 80%+ daily cap usage.

---

## ERC-7715 Permission Request Flow

1. **Agent requests permissions** — specifies desired caveats (spend cap, time window, target contracts).
2. **User reviews** — the permission manager produces a human-readable summary.
3. **User signs** — EIP-712 typed-data signature over the Delegation struct.
4. **Agent operates** — every action is validated against caveats before execution.
5. **Alerts** — spending tracker warns when cumulative spend exceeds 80% of daily cap.

## Caveat Enforcers

| Enforcer | Purpose |
|---|---|
| `SpendingLimitEnforcer` | Caps wei per transaction and per rolling 24h window |
| `TimeBoundEnforcer` | Restricts delegation to a `[validFrom, validUntil]` window |
| `AllowedTargetsEnforcer` | Whitelists contract addresses the agent may call |
| `ERC20AllowanceEnforcer` | Limits ERC-20 token transfers |

Each enforcer is an on-chain contract that the `DelegationManager` calls during redemption. If **any** caveat rejects, the entire call reverts.

## Security Model

- **Agents never touch private keys.** The user signs the delegation off-chain; the agent only holds the signed delegation object.
- **Scoped by design.** Caveats are enforced on-chain — even a compromised agent cannot exceed its granted permissions.
- **Composable.** Multiple caveats stack (AND logic): an action must satisfy *all* enforcers.
- **Revocable.** The delegator can revoke any delegation at any time via the DelegationManager.

## Quick Start

```bash
npm install
cp .env.example .env   # add your key (optional for demo)
npm run demo            # → proof/demo.json
npm test                # 36 tests, fast & offline
```

## Project Structure

```
src/
  config.ts                  Chain & contract addresses
  delegation/
    types.ts                 ERC-7710 types & caveat params
    builder.ts               Build, encode, sign delegations
  agent/
    delegated-agent.ts       Execute within delegated scope
    permission-manager.ts    Human-readable summaries & alerts
  index.ts                   Entry point
scripts/
  demo.ts                    Demo → proof/demo.json
test/
  *.test.ts                  Vitest unit tests (36 tests)
```

## License

MIT
