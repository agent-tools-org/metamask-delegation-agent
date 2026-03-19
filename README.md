# MetaMask Delegation Agent

Hackathon submission for **"Best Use of Delegations"** sponsored by MetaMask ($5K prize).

An autonomous agent that operates **within scoped, user-defined permissions** using MetaMask's Delegation Toolkit (ERC-7710 / ERC-7715). The agent can spend, swap, or interact with contracts—but **only within the limits the user sets**.

## Architecture

```
User (Delegator)
  │
  ├─ Signs ERC-7710 Delegation (EIP-712)
  │    ├─ Spending Limit Caveat   → max per tx / per day
  │    ├─ Time Bound Caveat       → valid from / until
  │    └─ Contract Target Caveat  → whitelisted addresses
  │
  ▼
Delegation Agent
  │
  ├─ checkPermissions()     → introspect what it can do
  ├─ validateAction()       → dry-run against caveat rules
  ├─ executeWithinDelegation() → submit if valid
  └─ trackSpending()        → running total vs limits
  │
  ▼
On-Chain (Base Sepolia)
  └─ DelegationManager (ERC-7710)
       └─ Caveat Enforcers verify every call
```

## ERC-7715 Permission Request Flow

1. **Agent requests permissions** — specifies desired caveats (spend cap, time window, target contracts).
2. **User reviews** — the permission manager produces a human-readable summary (e.g., *"This agent can: spend up to 0.01 ETH/tx, only on Uniswap, until March 31"*).
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
npm test                # 15+ tests, fast & offline
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
  *.test.ts                  Vitest unit tests
```

## License

MIT
