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

## Orchestration patterns

### Swap pattern

```
1.  get_wallets                              → address
2.  GET /state/quote?tokenIn=...&tokenOut=...&amount=...&recipient=<address>
      → inspect quote.amountOut, quote.priceImpact — confirm with user
3.  GET /prepare/swap?tokenIn=...&tokenOut=...&amount=...&recipient=<address>
      → transactions[]
4.  send_calls(chain="base", calls from transactions[])
5.  get_request_status(requestId)            → confirm swap success
```

### Stake pattern

```
1.  get_wallets                              → address
2.  GET /state/portfolio?address=<address>   → confirm LP token balance
3.  GET /prepare/stake?from=<address>&gauge=<gauge>&lpToken=<lpToken>&amount=<amount>
      → transactions: [approve, stake]
4.  send_calls(chain="base", calls from transactions[])
5.  get_request_status(requestId)            → confirm staking success
```

### Unstake pattern

```
1.  get_wallets                              → address
2.  GET /state/portfolio?address=<address>   → confirm staked balance
3.  GET /prepare/unstake?from=<address>&gauge=<gauge>&amount=<amount>
      → transactions: [unstake]
4.  send_calls(chain="base", calls from transactions[])
5.  get_request_status(requestId)
```

### Claim rewards pattern

```
1.  get_wallets                              → address
2.  GET /prepare/claim?from=<address>&gauge=<gauge>
      → transactions: [claim]
3.  send_calls(chain="base", calls from transactions[])
4.  get_request_status(requestId)
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
