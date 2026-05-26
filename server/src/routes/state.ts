import { Router, Request, Response } from "express";
import { z } from "zod";
import { ROUTER_API_BASE, CHAIN_ID } from "../lib/constants";

const router = Router();

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address");

/**
 * GET /state/quote
 * Proxies the Hydrex Router API quote endpoint and returns the best swap
 * rate with executable transaction payload.
 *
 * Query params:
 *   tokenIn    - input token address
 *   tokenOut   - output token address
 *   amount     - input amount in wei (as decimal string)
 *   recipient  - wallet address that will execute the swap
 *   slippage   - slippage tolerance in basis points (default: 50 = 0.5%)
 *   source     - optional aggregator filter: ZEROX | OPENOCEAN | OKX | KYBERSWAP
 */
router.get("/quote", async (req: Request, res: Response) => {
  const schema = z.object({
    tokenIn: addressSchema,
    tokenOut: addressSchema,
    amount: z.string().min(1),
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

  const { tokenIn, tokenOut, amount, recipient, slippage, source } =
    parsed.data;

  const params = new URLSearchParams({
    tokenIn,
    tokenOut,
    amount,
    recipient,
    chainId: String(CHAIN_ID),
    slippage: String(slippage),
  });
  if (source) params.set("source", source);

  try {
    const upstream = await fetch(
      `${ROUTER_API_BASE}/quote?${params.toString()}`
    );
    const data = await upstream.json();
    return res.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return res.status(502).json({ ok: false, error: message });
  }
});

/**
 * GET /state/portfolio
 * Returns token balances and positions for a wallet address.
 *
 * Query params:
 *   address - wallet address
 */
router.get("/portfolio", async (req: Request, res: Response) => {
  const parsed = z.object({ address: addressSchema }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { address } = parsed.data;

  try {
    const upstream = await fetch(
      `${ROUTER_API_BASE}/portfolio/address/${address}`
    );
    const data = await upstream.json();
    return res.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return res.status(502).json({ ok: false, error: message });
  }
});

/**
 * GET /state/trade-history
 * Returns swap history for a wallet address.
 *
 * Query params:
 *   address - wallet address
 */
router.get("/trade-history", async (req: Request, res: Response) => {
  const parsed = z.object({ address: addressSchema }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { address } = parsed.data;

  try {
    const upstream = await fetch(
      `${ROUTER_API_BASE}/transactions/trade-history?address=${address}&chainId=${CHAIN_ID}`
    );
    const data = await upstream.json();
    return res.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return res.status(502).json({ ok: false, error: message });
  }
});

export default router;
