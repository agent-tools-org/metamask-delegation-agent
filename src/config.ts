import { type Chain } from "viem";
import { config } from "dotenv";

config();

/** Base Sepolia testnet chain configuration */
export const baseSepolia: Chain = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || "https://sepolia.base.org"] },
  },
  testnet: true,
};

/** Wallet private key from environment */
export const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** Delegation framework contract addresses (Base Sepolia) */
export const DELEGATION_FRAMEWORK = {
  /** DelegationManager — core registry for ERC-7710 delegations */
  delegationManager: "0x00000000000076A84feF008CDAbe6409d2FE638B" as const,
  /** MultiSigDeleGator factory */
  delegatorFactory: "0x0000000000B27f4E2578b6E0F5706C26E5e73106" as const,
  /** SpendingLimitEnforcer — caps per-tx or cumulative spend */
  spendingLimitEnforcer: "0x000000000034C4C4085a6489C0C6bF4F40bB6a5E" as const,
  /** TimeBoundEnforcer — restricts delegation validity window */
  timeBoundEnforcer: "0x000000000082aE6A3396EDdF3a6414eE78d5790c" as const,
  /** AllowedTargetsEnforcer — restricts callable contracts */
  allowedTargetsEnforcer: "0x00000000005F7e08A298de4EdBb7E0ca08CF5CdA" as const,
  /** ERC20AllowanceEnforcer — caps ERC-20 token spend */
  erc20AllowanceEnforcer: "0x0000000000Ce1bD07e9cb230Ce7A08dEC8B6ecF0" as const,
} as const;

/** Default chain used throughout the agent */
export const DEFAULT_CHAIN = baseSepolia;
