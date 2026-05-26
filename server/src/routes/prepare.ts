import { Router, Request, Response } from "express";
import { z } from "zod";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { CHAIN_ID, ROUTER_API_BASE } from "../lib/constants";

const router = Router();

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address")
  .transform((v) => v as Address);

/** Minimal ERC-20 ABI fragments needed for approval encoding */
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

/** Minimal Gauge ABI fragments for deposit */
const gaugeDepositAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

/** Minimal Gauge ABI for claiming rewards */
const gaugeGetRewardAbi = [
  {
    name: "getReward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
] as const;

/** Minimal Gauge ABI for withdrawing */
const gaugeWithdrawAbi = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

/**
 * GET /prepare/swap
 * Fetches the best route from the Hydrex Router API and returns
 * executable calldata in the ordered-batch format expected by
 * Base MCP's send_calls.
 *
 * Query params:
 *   tokenIn    - input token address
 *   tokenOut   - output token address
 *   amount     - human-readable amount (e.g. "1.5" for 1.5 USDC)
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
    source: z
      .enum(["ZEROX", "OPENOCEAN", "OKX", "KYBERSWAP"])
      .optional(),
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
    const upstream = await fetch(
      `${ROUTER_API_BASE}/quote?${params.toString()}`
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      return res
        .status(upstream.status)
        .json({ ok: false, error: `Router API error: ${text}` });
    }

    const quote = await upstream.json();

    // The Router API returns executable tx data directly.
    // Wrap in the ordered-batch shape Base MCP expects.
    const transactions = [
      {
        step: "swap",
        to: quote.to,
        data: quote.data,
        value: quote.value ?? "0x0",
        chainId: CHAIN_ID,
      },
    ];

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
      transactions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ ok: false, error: message });
  }
});

/**
 * GET /prepare/stake
 * Builds an approve + deposit batch for staking LP tokens into a Hydrex gauge.
 *
 * Query params:
 *   from        - wallet address (must hold LP tokens)
 *   gauge       - gauge contract address
 *   lpToken     - LP token contract address
 *   amount      - human-readable LP token amount (e.g. "1.0")
 *   decimals    - LP token decimals (default: 18)
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

  const approveData = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [gauge, amountWei],
  });

  const depositData = encodeFunctionData({
    abi: gaugeDepositAbi,
    functionName: "deposit",
    args: [amountWei],
  });

  return res.json({
    ok: true,
    transactions: [
      {
        step: "approve",
        to: lpToken,
        data: approveData,
        value: "0x0",
        chainId: CHAIN_ID,
      },
      {
        step: "stake",
        to: gauge,
        data: depositData,
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

/**
 * GET /prepare/unstake
 * Builds a withdraw calldata batch for removing staked LP tokens from a gauge.
 *
 * Query params:
 *   from        - wallet address
 *   gauge       - gauge contract address
 *   amount      - human-readable LP token amount to withdraw
 *   decimals    - LP token decimals (default: 18)
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

  const withdrawData = encodeFunctionData({
    abi: gaugeWithdrawAbi,
    functionName: "withdraw",
    args: [amountWei],
  });

  return res.json({
    ok: true,
    transactions: [
      {
        step: "unstake",
        to: gauge,
        data: withdrawData,
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

/**
 * GET /prepare/claim
 * Builds calldata to claim pending gauge rewards for a wallet.
 *
 * Query params:
 *   from   - wallet address (rewards recipient)
 *   gauge  - gauge contract address
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

  const claimData = encodeFunctionData({
    abi: gaugeGetRewardAbi,
    functionName: "getReward",
    args: [from],
  });

  return res.json({
    ok: true,
    transactions: [
      {
        step: "claim",
        to: gauge,
        data: claimData,
        value: "0x0",
        chainId: CHAIN_ID,
      },
    ],
  });
});

export default router;
