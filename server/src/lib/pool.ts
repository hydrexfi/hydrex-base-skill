import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import {
  Token,
  Pool,
  Position,
  ChainId,
  Price,
  CurrencyAmount,
  Percent,
  nearestUsableTick,
  priceToClosestTick,
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  ADDRESS_ZERO,
} from "@hydrexfi/hydrex-sdk";
import { POOL_ABI, NFPM_ABI } from "./constants";

const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

export const NFPM_ADDRESS =
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[ChainId.Base] as Address;

/**
 * Reads on-chain state for a Hydrex pool and returns an SDK Pool instance.
 *
 * Hydrex pools expose an Algebra-style `globalState()` function instead of
 * Uniswap V3's `slot0()`. `globalState` returns sqrtPriceX96, tick, and the
 * current dynamic fee in a single call.
 */
export async function fetchPool(
  poolAddress: Address,
  token0Address: Address,
  token1Address: Address,
  decimals0: number,
  decimals1: number
): Promise<Pool> {
  const [globalState, liquidity, tickSpacing] = await Promise.all([
    publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "globalState",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "liquidity",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "tickSpacing",
    }),
  ]);

  const token0 = new Token(ChainId.Base, token0Address, decimals0);
  const token1 = new Token(ChainId.Base, token1Address, decimals1);

  // Viem returns named-tuple ABI results as positional arrays; access by index.
  // globalState: [price (uint160), tick (int24), fee (uint16), ...]
  const sqrtPriceX96 = globalState[0];
  const tick = globalState[1];
  const fee = globalState[2];

  return new Pool(
    token0,
    token1,
    fee,
    sqrtPriceX96.toString(),
    ADDRESS_ZERO,
    liquidity.toString(),
    tick,
    tickSpacing
  );
}

/**
 * Converts a human-readable price (token1 per token0) to the nearest
 * usable tick for the given pool tick spacing.
 *
 * Example: humanPrice=2000 for a WETH/USDC pool means 2000 USDC per WETH.
 */
export function priceToTick(
  humanPrice: number,
  token0: Token,
  token1: Token,
  tickSpacing: number
): number {
  const sdkPrice = new Price(
    token0,
    token1,
    (10 ** token0.decimals).toString(),
    Math.round(humanPrice * 10 ** token1.decimals).toString()
  );
  const rawTick = priceToClosestTick(sdkPrice);
  return nearestUsableTick(rawTick, tickSpacing);
}

/**
 * Fetches on-chain data for a NFPM position by tokenId.
 */
export async function fetchPosition(tokenId: bigint): Promise<{
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}> {
  const pos = await publicClient.readContract({
    address: NFPM_ADDRESS,
    abi: NFPM_ABI,
    functionName: "positions",
    args: [tokenId],
  });

  // Viem returns named-tuple ABI results as positional arrays; access by index.
  // positions: [nonce, operator, token0, token1, fee, tickLower, tickUpper,
  //             liquidity, feeGrowth0, feeGrowth1, tokensOwed0, tokensOwed1]
  return {
    token0: pos[2] as Address,
    token1: pos[3] as Address,
    fee: pos[4],
    tickLower: pos[5],
    tickUpper: pos[6],
    liquidity: pos[7],
    tokensOwed0: pos[10],
    tokensOwed1: pos[11],
  };
}

/**
 * Returns all position tokenIds owned by an address.
 */
export async function fetchPositionIds(owner: Address): Promise<bigint[]> {
  const count = await publicClient.readContract({
    address: NFPM_ADDRESS,
    abi: NFPM_ABI,
    functionName: "balanceOf",
    args: [owner],
  });

  const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i));

  return Promise.all(
    indices.map((i) =>
      publicClient.readContract({
        address: NFPM_ADDRESS,
        abi: NFPM_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, i],
      })
    )
  );
}

export { Token, Pool, Position, CurrencyAmount, Percent, ChainId };
