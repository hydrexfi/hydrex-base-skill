import { Router, Request, Response } from "express";
import { z } from "zod";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import {
  NonfungiblePositionManager,
  Position,
  Token,
  CurrencyAmount,
  Percent,
  ChainId,
} from "@hydrexfi/hydrex-sdk";
import { CHAIN_ID, ROUTER_API_BASE } from "../lib/constants";
import { fetchPool, fetchPosition, priceToTick, NFPM_ADDRESS } from "../lib/pool";

const router = Router();

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address")
  .transform((v) => v as Address);

// ─── ABI fragments for gauge interactions ────────────────────────────────────

const erc20ApproveAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const gaugeDepositAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const gaugeGetRewardAbi = [
  {
    name: "getReward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
] as const;

const gaugeWithdrawAbi = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

// ─── Swap ─────────────────────────────────────────────────────────────────────

/**
 * GET /prepare/swap
 *
 * Fetches the best route from the Hydrex Router API and returns executable
 * calldata in the ordered-batch format expected by Base MCP's send_calls.
 *
 * Query params:
 *   tokenIn    - input token address
 *   tokenOut   - output token address
 *   amount     - human-readable input amount (e.g. "1.5" for 1.5 USDC)
 *   decimals   - decimals of tokenIn (default: 18)
 *   recipient  - wallet address
 *   slippage   - slippage in bps (default: 50 = 0.5%)
 *   source     - optional aggregator: ZEROX | OPENOCEAN | OKX | KYBERSWAP
 */
router.get("/swap", async (req: Request, res: Response) => {
  const schema = z.object({
    tokenIn: addressSchema,
    tokenOut: addressSchema,
    amount: z.string().min(1),
    decimals: z.coerce.number().min(0).max(18).default(18),
    recipient: addressSchema,
    slippage: z.coerce.number().min(1).max(5000).default(50),
    source: z.enum(["ZEROX", "OPENOCEAN", "OKX", "KYBERSWAP"]).optional(),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { tokenIn, tokenOut, amount, decimals, recipient, slippage, source } =
    parsed.data;

  const amountWei = parseUnits(amount, decimals).toString();
  const params = new URLSearchParams({
    tokenIn,
    tokenOut,
    amount: amountWei,
    recipient,
    chainId: String(CHAIN_ID),
    slippage: String(slippage),
  });
  if (source) params.set("source", source);

  try {
    const upstream = await fetch(`${ROUTER_API_BASE}/quote?${params}`);
    if (!upstream.ok) {
      const text = await upstream.text();
      return res
        .status(upstream.status)
        .json({ ok: false, error: `Router API error: ${text}` });
    }

    const quote = await upstream.json();

    return res.json({
      ok: true,
      quote: {
        tokenIn: quote.tokenIn ?? tokenIn,
        tokenOut: quote.tokenOut ?? tokenOut,
        amountIn: quote.amountIn ?? amountWei,
        amountOut: quote.amountOut,
        source: quote.source,
        priceImpact: quote.priceImpact,
      },
      transactions: [
        {
          step: "swap",
          to: quote.to,
          data: quote.data,
          value: quote.value ?? "0x0",
          chainId: CHAIN_ID,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ ok: false, error: message });
  }
});

// ─── Gauge staking ────────────────────────────────────────────────────────────

/**
 * GET /prepare/stake
 *
 * Builds an ERC-20 approve + gauge deposit batch for staking LP tokens.
 * Returns two transactions that must be submitted atomically via send_calls.
 *
 * Query params:
 *   from     - wallet address holding LP tokens
 *   gauge    - gauge contract address
 *   lpToken  - LP token contract address
 *   amount   - human-readable LP token amount (e.g. "1.0")
 *   decimals - LP token decimals (default: 18)
 */
router.get("/stake", async (req: Request, res: Response) => {
  const schema = z.object({
    from: addressSchema,
    gauge: addressSchema,
    lpToken: addressSchema,
    amount: z.string().min(1),
    decimals: z.coerce.number().min(0).max(18).default(18),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { gauge, lpToken, amount, decimals } = parsed.data;
  const amountWei = parseUnits(amount, decimals);

  return res.json({
    ok: true,
    transactions: [
      {
        step: "approve",
        to: lpToken,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [gauge, amountWei],
        }),
        value: "0x0",
        chainId: CHAIN_ID,
      },
      {
        step: "stake",
        to: gauge,
        data: encodeFunctionData({
          abi: gaugeDepositAbi,
          functionName: "deposit",
          args: [amountWei],
        }),
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

/**
 * GET /prepare/unstake
 *
 * Builds a gauge withdraw transaction for removing staked LP tokens.
 *
 * Query params:
 *   from     - wallet address with staked LP tokens
 *   gauge    - gauge contract address
 *   amount   - human-readable LP token amount to withdraw
 *   decimals - LP token decimals (default: 18)
 */
router.get("/unstake", async (req: Request, res: Response) => {
  const schema = z.object({
    from: addressSchema,
    gauge: addressSchema,
    amount: z.string().min(1),
    decimals: z.coerce.number().min(0).max(18).default(18),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { gauge, amount, decimals } = parsed.data;
  const amountWei = parseUnits(amount, decimals);

  return res.json({
    ok: true,
    transactions: [
      {
        step: "unstake",
        to: gauge,
        data: encodeFunctionData({
          abi: gaugeWithdrawAbi,
          functionName: "withdraw",
          args: [amountWei],
        }),
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

/**
 * GET /prepare/claim
 *
 * Builds a getReward transaction to claim pending gauge emissions.
 *
 * Query params:
 *   from  - wallet address (rewards recipient)
 *   gauge - gauge contract address
 */
router.get("/claim", async (req: Request, res: Response) => {
  const schema = z.object({
    from: addressSchema,
    gauge: addressSchema,
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { from, gauge } = parsed.data;

  return res.json({
    ok: true,
    transactions: [
      {
        step: "claim",
        to: gauge,
        data: encodeFunctionData({
          abi: gaugeGetRewardAbi,
          functionName: "getReward",
          args: [from],
        }),
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

// ─── Liquidity management ─────────────────────────────────────────────────────

/**
 * GET /prepare/add-liquidity
 *
 * Builds the calldata to mint a new concentrated liquidity position
 * via Hydrex's NonfungiblePositionManager. Returns an approve + approve
 * + mint batch (three transactions).
 *
 * Reads current pool state on-chain to resolve tick spacing and
 * current price. If priceLower/priceUpper are omitted, defaults to
 * ±20% of the current pool price.
 *
 * Query params:
 *   from        - wallet address providing liquidity
 *   pool        - pool contract address
 *   token0      - token0 contract address (must match pool order)
 *   token1      - token1 contract address (must match pool order)
 *   decimals0   - token0 decimals (default: 18)
 *   decimals1   - token1 decimals (default: 18)
 *   amount0     - desired token0 amount, human-readable (e.g. "0.05")
 *   amount1     - desired token1 amount, human-readable (e.g. "100")
 *   priceLower  - lower bound price (token1 per token0), optional
 *   priceUpper  - upper bound price (token1 per token0), optional
 *   slippage    - slippage in bps (default: 50)
 */
router.get("/add-liquidity", async (req: Request, res: Response) => {
  const schema = z.object({
    from: addressSchema,
    pool: addressSchema,
    token0: addressSchema,
    token1: addressSchema,
    decimals0: z.coerce.number().min(0).max(18).default(18),
    decimals1: z.coerce.number().min(0).max(18).default(18),
    amount0: z.string().min(1),
    amount1: z.string().min(1),
    priceLower: z.coerce.number().positive().optional(),
    priceUpper: z.coerce.number().positive().optional(),
    slippage: z.coerce.number().min(1).max(5000).default(50),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const {
    from,
    pool: poolAddress,
    token0: token0Address,
    token1: token1Address,
    decimals0,
    decimals1,
    amount0,
    amount1,
    priceLower,
    priceUpper,
    slippage,
  } = parsed.data;

  try {
    const pool = await fetchPool(
      poolAddress,
      token0Address,
      token1Address,
      decimals0,
      decimals1
    );

    const token0 = pool.token0 as Token;
    const token1 = pool.token1 as Token;

    // Default price range to ±20% of current price if not provided.
    // currentPrice is expressed as token1 per token0.
    const currentPrice = parseFloat(pool.token0Price.toSignificant(18));
    const lower = priceLower ?? currentPrice * 0.8;
    const upper = priceUpper ?? currentPrice * 1.2;

    const tickLower = priceToTick(lower, token0, token1, pool.tickSpacing);
    const tickUpper = priceToTick(upper, token0, token1, pool.tickSpacing);

    if (tickLower >= tickUpper) {
      return res.status(400).json({
        ok: false,
        error:
          "priceLower must be strictly less than priceUpper after tick rounding",
      });
    }

    const amount0Raw = parseUnits(amount0, decimals0);
    const amount1Raw = parseUnits(amount1, decimals1);

    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: amount0Raw.toString(),
      amount1: amount1Raw.toString(),
      useFullPrecision: true,
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const slippagePct = new Percent(slippage, 10_000);

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(
      position,
      {
        recipient: from,
        deadline,
        slippageTolerance: slippagePct,
      }
    );

    const approveToken0 = encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [NFPM_ADDRESS, amount0Raw],
    });

    const approveToken1 = encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [NFPM_ADDRESS, amount1Raw],
    });

    return res.json({
      ok: true,
      position: {
        tickLower,
        tickUpper,
        amount0: position.amount0.toSignificant(6),
        amount1: position.amount1.toSignificant(6),
      },
      transactions: [
        {
          step: "approve-token0",
          to: token0Address,
          data: approveToken0,
          value: "0x0",
          chainId: CHAIN_ID,
        },
        {
          step: "approve-token1",
          to: token1Address,
          data: approveToken1,
          value: "0x0",
          chainId: CHAIN_ID,
        },
        {
          step: "mint",
          to: NFPM_ADDRESS,
          data: calldata,
          value: `0x${BigInt(value).toString(16)}`,
          chainId: CHAIN_ID,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ ok: false, error: message });
  }
});

/**
 * GET /prepare/remove-liquidity
 *
 * Builds the calldata to decrease liquidity and collect tokens from an
 * existing NonfungiblePositionManager position. Reads position state
 * on-chain to determine current liquidity and owed tokens.
 *
 * Query params:
 *   from              - wallet address that owns the position
 *   positionId        - NFT tokenId of the position
 *   pool              - pool contract address
 *   decimals0         - token0 decimals (default: 18)
 *   decimals1         - token1 decimals (default: 18)
 *   liquidityPercent  - percentage of liquidity to remove, 1–100 (default: 100)
 *   slippage          - slippage in bps (default: 50)
 */
router.get("/remove-liquidity", async (req: Request, res: Response) => {
  const schema = z.object({
    from: addressSchema,
    positionId: z.coerce.bigint().positive(),
    pool: addressSchema,
    decimals0: z.coerce.number().min(0).max(18).default(18),
    decimals1: z.coerce.number().min(0).max(18).default(18),
    liquidityPercent: z.coerce.number().min(1).max(100).default(100),
    slippage: z.coerce.number().min(1).max(5000).default(50),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const {
    from,
    positionId,
    pool: poolAddress,
    decimals0,
    decimals1,
    liquidityPercent,
    slippage,
  } = parsed.data;

  try {
    const posData = await fetchPosition(positionId);

    if (posData.liquidity === 0n) {
      return res
        .status(400)
        .json({ ok: false, error: "Position has no liquidity to remove" });
    }

    const pool = await fetchPool(
      poolAddress,
      posData.token0,
      posData.token1,
      decimals0,
      decimals1
    );

    const position = new Position({
      pool,
      tickLower: posData.tickLower,
      tickUpper: posData.tickUpper,
      liquidity: posData.liquidity.toString(),
    });

    const token0 = pool.token0 as Token;
    const token1 = pool.token1 as Token;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const slippagePct = new Percent(slippage, 10_000);
    const liquidityPct = new Percent(liquidityPercent, 100);

    const { calldata, value } =
      NonfungiblePositionManager.removeCallParameters(position, {
        tokenId: positionId.toString(),
        liquidityPercentage: liquidityPct,
        slippageTolerance: slippagePct,
        deadline,
        collectOptions: {
          expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(
            token0,
            posData.tokensOwed0.toString()
          ),
          expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(
            token1,
            posData.tokensOwed1.toString()
          ),
          recipient: from,
        },
      });

    return res.json({
      ok: true,
      transactions: [
        {
          step: "remove-liquidity",
          to: NFPM_ADDRESS,
          data: calldata,
          value: `0x${BigInt(value).toString(16)}`,
          chainId: CHAIN_ID,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ ok: false, error: message });
  }
});

export default router;
