export const CHAIN_ID = 8453; // Base mainnet

/**
 * Well-known token addresses on Base mainnet.
 * Extend as needed for additional tokens.
 */
export const TOKENS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006",
  HYDX: "0x0000000000000000000000000000000000000000", // TODO: replace with live HYDX address
} as const;

/**
 * Hydrex Router API base URL.
 * No auth required for public endpoints.
 */
export const ROUTER_API_BASE = "https://router.api.hydrex.fi";

/**
 * Token decimals for common assets.
 */
export const TOKEN_DECIMALS: Record<string, number> = {
  [TOKENS.USDC]: 6,
  [TOKENS.WETH]: 18,
};
