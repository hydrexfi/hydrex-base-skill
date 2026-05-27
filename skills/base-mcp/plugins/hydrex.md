# Hydrex Plugin

> [!IMPORTANT]
> ## STOP — COMPLETE ONBOARDING BEFORE USING THIS PLUGIN
>
> Before calling any Hydrex endpoint you **MUST** complete the Base MCP onboarding flow:
> 1. Call `get_wallets` — this confirms the user's wallet address.
> 2. Present wallet status and the standard Base MCP disclaimer.
>
> Every prepare endpoint requires the wallet address as the `from` or `recipient`
> parameter. Do **not** proceed without it.

Hydrex is an Omni-Liquidity MetaDEX on Base — concentrated-liquidity swaps aggregated across 0x, OpenOcean, OKX, and KyberSwap, plus gauge-based LP staking with HYDX rewards. Fetch unsigned calldata from the Hydrex API, then execute via Base MCP's `send_calls`.

**Chain:** Base mainnet (`chainId: 8453` / `"chain": "base"`).

**Fetching calldata:** the Hydrex prepare server is not on the Base MCP `web_request` allowlist. Construct all URLs as **GET** requests with parameters in the query string. If `web_request` is unavailable, ask the user to open the URL in a browser and paste the JSON response back into chat, then continue with `send_calls`.

---

## Approval & confirmation UX

After calling `send_calls`, Base MCP returns a `requestId` and presents the user with an approval link. **Do not ask the user to type "confirmed" or any other acknowledgement.** Instead:

1. Tell the user clearly: "Please approve the transaction using the link above."
2. Immediately call `get_request_status(requestId)` to begin polling.
3. If the status is `pending`, call `get_request_status` again automatically — keep polling without prompting the user until the status is `success` or `failed`.
4. Once resolved, report the outcome (tx hash on success, error reason on failure).

The user's only required action is clicking the Coinbase approval link. Everything else is handled automatically.

---

## Orchestration patterns

### Swap pattern

```
1.  get_wallets                              → address
2.  GET /state/quote?tokenIn=...&tokenOut=...&amount=...&recipient=<address>
      → show user: amountOut (human-readable), priceImpact, source
      → if priceImpact > 5%, warn user and ask to confirm before proceeding
3.  GET /prepare/swap?tokenIn=...&tokenOut=...&amount=...&recipient=<address>
      → transactions[]
4.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve the transaction using the link above."
5.  get_request_status(requestId) — poll automatically until success or failed
      → report outcome; do NOT ask user to type anything
```

### Stake pattern

```
1.  get_wallets                              → address
2.  GET /state/portfolio?address=<address>   → confirm LP token balance
3.  GET /prepare/stake?from=<address>&gauge=<gauge>&lpToken=<lpToken>&amount=<amount>
      → transactions: [approve, stake]
4.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve both the token approval and stake in the link above."
5.  get_request_status(requestId) — poll automatically until success or failed
```

### Unstake pattern

```
1.  get_wallets                              → address
2.  GET /state/portfolio?address=<address>   → confirm staked balance
3.  GET /prepare/unstake?from=<address>&gauge=<gauge>&amount=<amount>
      → transactions: [unstake]
4.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve the transaction using the link above."
5.  get_request_status(requestId) — poll automatically until success or failed
```

### Claim rewards pattern

```
1.  get_wallets                              → address
2.  GET /prepare/claim?from=<address>&gauge=<gauge>
      → transactions: [claim]
3.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve the transaction using the link above."
4.  get_request_status(requestId) — poll automatically until success or failed
```

### Add liquidity pattern

```
1.  get_wallets                              → address
2.  GET /state/positions?address=<address>   → show existing positions for context
3.  Confirm with user: pool address, token pair, amounts, price range (or use default ±20%)
4.  GET /prepare/add-liquidity?from=<address>&pool=<pool>&token0=<t0>&token1=<t1>
        &decimals0=<d0>&decimals1=<d1>&amount0=<a0>&amount1=<a1>
        [&priceLower=<p>&priceUpper=<p>]
      → transactions: [approve-token0, approve-token1, mint]
      → show user: position.tickLower, position.tickUpper, position.amount0, position.amount1
5.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve both token allowances and the mint in the link above."
6.  get_request_status(requestId) — poll automatically until success or failed
```

> Price range guidance: if the user does not specify a range, default to ±20% of current pool price and
> tell them: "I'm using a ±20% price range around the current price. You can specify a tighter or wider
> range if you prefer."

### Remove liquidity pattern

```
1.  get_wallets                              → address
2.  GET /state/positions?address=<address>   → list open positions with positionId values
3.  Confirm which positionId and what percentage to remove (default: 100%)
4.  GET /prepare/remove-liquidity?from=<address>&positionId=<id>&pool=<pool>
        &decimals0=<d0>&decimals1=<d1>[&liquidityPercent=<pct>]
      → transactions: [remove-liquidity]
5.  send_calls(chain="base", calls from transactions[])
      → tell user: "Please approve the transaction using the link above."
6.  get_request_status(requestId) — poll automatically until success or failed
```

---

## Read endpoints

**Base URL:** `http://localhost:3000` (or wherever the prepare server is deployed)

### Health check

```
GET /health
```

Response:
```json
{ "ok": true, "service": "hydrex-base-skill-server", "chainId": 8453 }
```

---

### Swap quote

```
GET /state/quote
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tokenIn` | address | ✓ | Input token contract address |
| `tokenOut` | address | ✓ | Output token contract address |
| `amount` | string (wei) | ✓ | Input amount in raw units (wei) |
| `recipient` | address | ✓ | Wallet that receives output tokens |
| `slippage` | number | — | Slippage tolerance in bps (default: 50 = 0.5%) |
| `source` | string | — | Force a specific aggregator: `ZEROX`, `OPENOCEAN`, `OKX`, `KYBERSWAP` |

Response shape:
```json
{
  "ok": true,
  "data": {
    "tokenIn": "0x...",
    "tokenOut": "0x...",
    "amountIn": "1000000",
    "amountOut": "412345678901234",
    "source": "ZEROX",
    "priceImpact": "0.12",
    "to": "0x...",
    "data": "0x...",
    "value": "0x0"
  }
}
```

Always show the user `amountOut` (converted to human-readable) and `priceImpact` before executing.

---

### Portfolio / balances

```
GET /state/portfolio?address=<walletAddress>
```

Returns token balances and LP positions for the wallet.

---

### Trade history

```
GET /state/trade-history?address=<walletAddress>
```

Returns past swaps executed through Hydrex for the wallet.

---

### Open liquidity positions

```
GET /state/positions?address=<walletAddress>
```

Returns all open concentrated liquidity positions owned by the wallet,
read directly from the NonfungiblePositionManager on-chain.

Response shape:
```json
{
  "ok": true,
  "count": 2,
  "positions": [
    {
      "positionId": "12345",
      "token0": "0x...",
      "token1": "0x...",
      "fee": 500,
      "tickLower": -887220,
      "tickUpper": 887220,
      "liquidity": "1500000000000000",
      "tokensOwed0": "0",
      "tokensOwed1": "0"
    }
  ]
}
```

Use `positionId` with `/prepare/remove-liquidity`.

---

## Prepare endpoints

All prepare endpoints return the ordered-batch shape:

```json
{
  "ok": true,
  "transactions": [
    { "step": "<label>", "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

### Prepare swap

```
GET /prepare/swap
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tokenIn` | address | ✓ | Input token address |
| `tokenOut` | address | ✓ | Output token address |
| `amount` | string | ✓ | Human-readable input amount (e.g. `"1.5"`) |
| `decimals` | number | — | Decimals of `tokenIn` (default: 18) |
| `recipient` | address | ✓ | Wallet that receives output tokens |
| `slippage` | number | — | Slippage in bps (default: 50) |
| `source` | string | — | Optional aggregator override |

Example:
```
GET /prepare/swap?tokenIn=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&tokenOut=0x4200000000000000000000000000000000000006&amount=1.5&decimals=6&recipient=0xYourWallet&slippage=50
```

Response:
```json
{
  "ok": true,
  "quote": {
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x4200000000000000000000000000000000000006",
    "amountIn": "1500000",
    "amountOut": "618522345678901",
    "source": "ZEROX",
    "priceImpact": "0.08"
  },
  "transactions": [
    {
      "step": "swap",
      "to": "0x<SwapRouter>",
      "data": "0x<encodedCalldata>",
      "value": "0x0",
      "chainId": 8453
    }
  ]
}
```

---

### Prepare stake

```
GET /prepare/stake
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | address | ✓ | Wallet address holding LP tokens |
| `gauge` | address | ✓ | Gauge contract address to deposit into |
| `lpToken` | address | ✓ | LP token contract address |
| `amount` | string | ✓ | Human-readable LP token amount (e.g. `"1.0"`) |
| `decimals` | number | — | LP token decimals (default: 18) |

Response — two transactions, always in this order:
```json
{
  "ok": true,
  "transactions": [
    { "step": "approve", "to": "0x<lpToken>",  "data": "0x<approveCalldata>", "value": "0x0", "chainId": 8453 },
    { "step": "stake",   "to": "0x<gauge>",    "data": "0x<depositCalldata>", "value": "0x0", "chainId": 8453 }
  ]
}
```

> The approve must be included in the same `send_calls` batch as the stake so they execute atomically in a single user approval.

---

### Prepare unstake

```
GET /prepare/unstake
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | address | ✓ | Wallet address with staked LP tokens |
| `gauge` | address | ✓ | Gauge contract address |
| `amount` | string | ✓ | Human-readable LP token amount to withdraw |
| `decimals` | number | — | LP token decimals (default: 18) |

Response:
```json
{
  "ok": true,
  "transactions": [
    { "step": "unstake", "to": "0x<gauge>", "data": "0x<withdrawCalldata>", "value": "0x0", "chainId": 8453 }
  ]
}
```

---

### Prepare claim rewards

```
GET /prepare/claim
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | address | ✓ | Wallet address to receive rewards |
| `gauge` | address | ✓ | Gauge contract address |

Response:
```json
{
  "ok": true,
  "transactions": [
    { "step": "claim", "to": "0x<gauge>", "data": "0x<getRewardCalldata>", "value": "0x0", "chainId": 8453 }
  ]
}
```

---

### Prepare add liquidity

```
GET /prepare/add-liquidity
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | address | ✓ | Wallet providing liquidity |
| `pool` | address | ✓ | Pool contract address |
| `token0` | address | ✓ | token0 address (must match pool order) |
| `token1` | address | ✓ | token1 address (must match pool order) |
| `decimals0` | number | — | token0 decimals (default: 18) |
| `decimals1` | number | — | token1 decimals (default: 18) |
| `amount0` | string | ✓ | Desired token0 amount, human-readable |
| `amount1` | string | ✓ | Desired token1 amount, human-readable |
| `priceLower` | number | — | Lower price bound (token1 per token0). Defaults to −20% of current price |
| `priceUpper` | number | — | Upper price bound (token1 per token0). Defaults to +20% of current price |
| `slippage` | number | — | Slippage in bps (default: 50) |

Response — three transactions, always in this order:
```json
{
  "ok": true,
  "position": { "tickLower": -887220, "tickUpper": 887220, "amount0": "0.05", "amount1": "100.0" },
  "transactions": [
    { "step": "approve-token0", "to": "0x<token0>", "data": "0x...", "value": "0x0", "chainId": 8453 },
    { "step": "approve-token1", "to": "0x<token1>", "data": "0x...", "value": "0x0", "chainId": 8453 },
    { "step": "mint",           "to": "0x<NFPM>",   "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

---

### Prepare remove liquidity

```
GET /prepare/remove-liquidity
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | address | ✓ | Wallet that owns the position |
| `positionId` | number | ✓ | NFT tokenId from `/state/positions` |
| `pool` | address | ✓ | Pool contract address |
| `decimals0` | number | — | token0 decimals (default: 18) |
| `decimals1` | number | — | token1 decimals (default: 18) |
| `liquidityPercent` | number | — | Percentage to remove, 1–100 (default: 100) |
| `slippage` | number | — | Slippage in bps (default: 50) |

Response:
```json
{
  "ok": true,
  "transactions": [
    { "step": "remove-liquidity", "to": "0x<NFPM>", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

---

## `send_calls` mapping

Convert any `transactions` array from a prepare endpoint into `send_calls`:

```json
{
  "chain": "base",
  "calls": [
    { "to": "<tx.to>", "value": "<tx.value>", "data": "<tx.data>" }
  ]
}
```

Multiple transactions (e.g. approve + stake) are passed as a single `calls` array — Base MCP executes them atomically in one user approval.

---

## Well-known token addresses (Base mainnet)

| Symbol | Address | Decimals |
|---|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| ETH (native) | use `value` field, no `tokenIn` address needed | 18 |

> For other tokens, look up the address via `GET /state/quote` error messages or ask the user to provide the contract address.

---

## Error handling

| Condition | Action |
|---|---|
| `get_wallets` returns no wallet | Tell user to connect their Base Account and try again |
| `/state/quote` returns `priceImpact > 5%` | Warn user about high price impact before proceeding |
| Prepare endpoint returns `ok: false` | Surface the `error` field to the user; do not call `send_calls` |
| `send_calls` approval rejected | Inform user the transaction was cancelled; offer to retry |
| `get_request_status` shows failure | Parse the failure reason and suggest next steps |
