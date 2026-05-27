# hydrex-base-skill

A [Base MCP](https://docs.base.org/ai-agents) custom plugin for [Hydrex](https://hydrex.fi) on Base mainnet. Lets AI assistants (Cursor, Claude, ChatGPT) quote swaps, add/remove liquidity, and manage gauge staking — all through the user's Base Account wallet.

---

## What it does

| Action | How |
|---|---|
| Swap any token pair | Hydrex Router API (`router.api.hydrex.fi`) |
| Add concentrated liquidity (manual position) | Hydrex SDK `NonfungiblePositionManager` |
| Remove liquidity | Hydrex SDK `NonfungiblePositionManager` |
| Stake LP tokens into a gauge | ABI-encoded `deposit` call |
| Unstake LP tokens from a gauge | ABI-encoded `withdraw` call |
| Claim gauge rewards | ABI-encoded `getReward` call |
| Read open positions (on-chain) | NFPM contract read |
| Read portfolio + trade history | Hydrex Router API |

Write actions go through Base MCP's `send_calls` — the user approves each batch in their wallet via a single Coinbase popup.

---

## How it works

Base MCP plugins are markdown specs that tell an AI which APIs to call and how to convert the response into onchain calls. This repo has two parts:

1. **`skills/base-mcp/plugins/hydrex.md`** — the plugin spec. Defines onboarding, read endpoints, prepare endpoints, and the `send_calls` mapping.
2. **`server/`** — a small Express server that exposes GET prepare-endpoints. Custom hosts are not on Base MCP's `web_request` allowlist, so this server acts as the calldata builder.

```
get_wallets → read state → GET /prepare/<action> → send_calls → get_request_status
```

---

## Repo layout

```
skills/base-mcp/plugins/hydrex.md   plugin spec (main deliverable)
server/src/routes/prepare.ts        calldata endpoints (swap, stake, liquidity)
server/src/routes/state.ts          read endpoints (quote, portfolio, positions)
server/src/lib/pool.ts              Hydrex SDK pool helpers + price→tick math
server/src/lib/constants.ts         pool + NFPM ABI fragments
.cursor/mcp.json                    Base MCP connection for Cursor
```

---

## Quick start

### 1 — Connect Base MCP in Cursor

The `.cursor/mcp.json` in this repo auto-registers `base-mcp`. After cloning, restart Cursor and go to **Settings (`Ctrl+Shift+J`) → Tools & MCP** to confirm it's active.

### 2 — Load the plugin as a Cursor rule

```bash
mkdir -p .cursor/rules
cp skills/base-mcp/plugins/hydrex.md .cursor/rules/hydrex.mdc
```

The rule loads automatically in every new chat for this project.

### 3 — Run the prepare server

```bash
cd server
cp .env.example .env   # BASE_RPC_URL is required for add/remove liquidity
npm install
npm run dev            # http://localhost:3000
```

Verify it's running:
```bash
curl http://localhost:3000/health
# {"ok":true,"service":"hydrex-base-skill-server","chainId":8453}
```

Swap routing works without the server (hits the Hydrex Router API directly). Liquidity and staking endpoints require the server.

---

## How to prompt the agent

Open a new agent chat in Cursor. Use the formats below. For gauges and pools, supply the contract addresses from [hydrex.fi](https://hydrex.fi).

### Swapping

```
Swap 5 USDC for ETH on Hydrex
Swap 0.01 ETH for USDC on Hydrex with 1% slippage
Swap 10 USDC for HYDX (0x<HYDX_ADDRESS>) on Hydrex
```

The agent fetches a quote from the Router API, shows you the output amount and price impact, then asks for confirmation before executing.

### Add liquidity

```
Add liquidity to the USDC/ETH pool on Hydrex
  pool: 0x<pool_address>
  amounts: 100 USDC and 0.04 ETH

Add liquidity to the USDC/ETH pool on Hydrex
  pool: 0x<pool_address>
  amounts: 100 USDC and 0.04 ETH
  price range: 1800 to 2200
```

If you omit `price range`, the agent defaults to **±20% of the current pool price** and tells you what range was used. The agent confirms the exact amounts and tick range before submitting.

The approval batch contains three calls: approve token0 → approve token1 → mint. All three are submitted in a single wallet approval.

### Remove liquidity

```
Show my Hydrex liquidity positions

Remove liquidity from my Hydrex position #<positionId>
  pool: 0x<pool_address>

Remove 50% of liquidity from Hydrex position #12345
  pool: 0x<pool_address>
```

Run "Show my Hydrex liquidity positions" first to see your open `positionId` values.

### Staking

```
Stake 1.0 LP tokens into the Hydrex USDC/ETH gauge
  gauge: 0x<gauge_address>
  LP token: 0x<lpToken_address>
```

The approval batch contains two calls: approve LP token → deposit into gauge. Atomic in one wallet approval.

### Unstaking

```
Unstake 1.0 LP tokens from the Hydrex USDC/ETH gauge
  gauge: 0x<gauge_address>
```

### Claim rewards

```
Claim my HYDX rewards from the Hydrex USDC/ETH gauge
  gauge: 0x<gauge_address>
```

### Portfolio & history

```
Show my Hydrex portfolio
Show my Hydrex liquidity positions
Show my Hydrex trade history
```

---

## Server endpoints

### Read

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/state/quote` | Best swap quote with tx payload |
| `GET` | `/state/portfolio` | Token balances for a wallet |
| `GET` | `/state/positions` | Open LP positions (on-chain, from NFPM) |
| `GET` | `/state/trade-history` | Swap history for a wallet |

### Prepare

All prepare endpoints return ordered-batch transactions:

```json
{
  "ok": true,
  "transactions": [
    { "step": "<label>", "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

| Method | Path | Key params |
|---|---|---|
| `GET` | `/prepare/swap` | `tokenIn`, `tokenOut`, `amount`, `decimals`, `recipient`, `slippage` |
| `GET` | `/prepare/add-liquidity` | `from`, `pool`, `token0`, `token1`, `amount0`, `amount1`, `priceLower`?, `priceUpper`? |
| `GET` | `/prepare/remove-liquidity` | `from`, `positionId`, `pool`, `liquidityPercent`?, `slippage` |
| `GET` | `/prepare/stake` | `from`, `gauge`, `lpToken`, `amount` |
| `GET` | `/prepare/unstake` | `from`, `gauge`, `amount` |
| `GET` | `/prepare/claim` | `from`, `gauge` |

---

## Supported network

| Network | Chain ID |
|---|---|
| Base mainnet | `8453` |

---

## References

- [Base MCP overview](https://docs.base.org/ai-agents)
- [Custom plugins guide](https://docs.base.org/ai-agents/plugins/custom-plugins)
- [Hydrex SDK docs](https://hydrex-sdk-docs.vercel.app/)
- [Hydrex Router API Swagger](https://router.api.hydrex.fi/api)
- [Base skills reference repo](https://github.com/base/skills)
