# hydrex-base-skill

A [Base MCP](https://docs.base.org/ai-agents) custom plugin that gives AI assistants (Claude, Cursor, ChatGPT) the ability to **swap tokens and stake LP positions on [Hydrex](https://hydrex.fi)** — the Omni-Liquidity MetaDEX on Base.

---

## What's in this repo

| Path | Purpose |
|---|---|
| `skills/base-mcp/plugins/hydrex.md` | The plugin spec — the main deliverable |
| `server/` | Lightweight Express server that exposes GET prepare-endpoints for the plugin |
| `.cursor/mcp.json` | Wires Base MCP into Cursor automatically |

---

## Quick start (teammates)

### 1 — Connect Base MCP in Cursor

Add the following to your **project** `.cursor/mcp.json` (already present in this repo) or your **global** `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    }
  }
}
```

Restart Cursor, then open **Settings → MCP** and confirm `base-mcp` shows as active. Authentication happens on first use via Base Account OAuth.

### 2 — Load the plugin

Copy or symlink `skills/base-mcp/plugins/hydrex.md` into your Base MCP plugins directory:

```bash
# If you're using the base/skills layout locally:
cp skills/base-mcp/plugins/hydrex.md ~/.cursor/skills/base-mcp/plugins/hydrex.md
```

Or reference it directly in your Cursor system prompt / rules file.

### 3 — Run the prepare server (required for staking)

The staking routes (stake, unstake, claim) require the local prepare server. Swap routing calls the public Hydrex Router API directly without the server.

```bash
cd server
cp .env.example .env          # add your BASE_RPC_URL
npm install
npm run dev                   # starts on http://localhost:3000
```

For production, build and run:

```bash
npm run build
npm start
```

---

## Supported actions

| Action | Requires server? | Underlying API |
|---|---|---|
| Swap quote + route | No | Hydrex Router API (`router.api.hydrex.fi`) |
| Execute swap | No | Hydrex Router API → Base MCP `send_calls` |
| Stake LP tokens | Yes | Server `/prepare/stake` → Base MCP `send_calls` |
| Unstake LP tokens | Yes | Server `/prepare/unstake` → Base MCP `send_calls` |
| Claim gauge rewards | Yes | Server `/prepare/claim` → Base MCP `send_calls` |
| Portfolio / positions | No | Hydrex Router API |
| Trade history | No | Hydrex Router API |

---

## Server endpoints

Base URL: `http://localhost:3000` (configurable via `PORT`)

### Read endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/state/quote` | Best swap quote with transaction payload |
| `GET` | `/state/portfolio` | Token balances and positions for a wallet |
| `GET` | `/state/trade-history` | Swap history for a wallet |

### Prepare endpoints

All prepare endpoints return an ordered-batch response in the format:

```json
{
  "ok": true,
  "transactions": [
    { "step": "approve", "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 },
    { "step": "stake",   "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

| Method | Path | Key params |
|---|---|---|
| `GET` | `/prepare/swap` | `tokenIn`, `tokenOut`, `amount`, `decimals`, `recipient`, `slippage` |
| `GET` | `/prepare/stake` | `from`, `gauge`, `lpToken`, `amount`, `decimals` |
| `GET` | `/prepare/unstake` | `from`, `gauge`, `amount`, `decimals` |
| `GET` | `/prepare/claim` | `from`, `gauge` |

---

## Supported network

| Network | Chain ID |
|---|---|
| Base mainnet | `8453` |

> Base Sepolia (`84532`) support is planned — the Hydrex SDK targets it but the router API currently serves mainnet only.

---

## Architecture

```
hydrex-base-skill/
├── .cursor/
│   └── mcp.json                  ← wires Base MCP into Cursor
├── skills/
│   └── base-mcp/
│       └── plugins/
│           └── hydrex.md         ← plugin spec (main deliverable)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts              ← Express entry point
│       ├── routes/
│       │   ├── state.ts          ← read endpoints
│       │   └── prepare.ts        ← calldata endpoints
│       └── lib/
│           ├── constants.ts      ← addresses, chain config
│           └── rpc.ts            ← viem public client
├── README.md
└── BUILD.md
```

---

## References

- [Base MCP overview](https://docs.base.org/ai-agents)
- [Custom plugins guide](https://docs.base.org/ai-agents/plugins/custom-plugins)
- [Hydrex SDK docs](https://hydrex-sdk-docs.vercel.app/)
- [Hydrex Router API docs](https://router-docs.hydrex.fi/)
- [Hydrex Router API Swagger UI](https://router.api.hydrex.fi/api)
- [Base skills reference repo](https://github.com/base/skills)
