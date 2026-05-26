# Base MCP Custom Plugin — Hydrex
## Context Handoff for Cursor

---

## The Task (from ClickUp)

Build a **Custom Plugin** for Base's MCP Agent:

1. Explore the MCP agent and its capabilities with existing plugins
2. Read the custom plugin docs at https://docs.base.org/ai-agents/plugins/custom-plugins
3. Scope and build an MVP integration — starting with **Hydrex routing & staking**
4. Test locally, then share with teammates (with setup instructions)

---

## What Base MCP Is

Base MCP is a remote MCP server at `https://mcp.base.org` that gives AI assistants (Claude, ChatGPT, Cursor, Claude Code, etc.) an onchain wallet to hold funds, swap tokens, batch contract calls, and interact with DeFi protocols. It connects via OAuth through **Base Account**. Every write action requires explicit user approval.

**Supported chains:** `base`, `ethereum`, `arbitrum`, `optimism`, `polygon`, `bsc`, `avalanche` (mainnets) + `base-sepolia` (testnet)

---

## Core Base MCP Tools

| Tool | What it does |
|---|---|
| `get_wallets` | Detect connected wallet address — **required first step in all flows** |
| `swap` | Swap tokens; params: `fromAsset`, `toAsset`, `amount`, `chain` |
| `send_calls` | Batch raw contract calls into one user approval; params: `chain`, `calls: [{to, value?, data?}]` |
| `send` | Send tokens to an address |
| `sign` | Sign messages / typed data |
| `web_request` | GET/POST to allowlisted partner APIs (custom hosts are NOT allowlisted) |
| `get_request_status` | Poll for approval/tx confirmation |

---

## What a Custom Plugin Is

A plugin is a **markdown spec file** that teaches the AI assistant how to:
1. Call an external API (read state)
2. Get unsigned calldata from a prepare endpoint
3. Pass that calldata to `send_calls` for a single user approval

Plugins live at: `skills/base-mcp/plugins/my-protocol.md`

---

## Plugin Anatomy (4 Required Sections)

### 1. Onboarding Gate
A `STOP` notice forcing `get_wallets` before anything else — the wallet address is required by every prepare call.

### 2. Read Endpoints
GET endpoints for state — balances, positions, market data, routing quotes.

### 3. Prepare Endpoints
GET endpoints returning unsigned calldata. Must return `to`, `value`, `data`, `chainId`.

> **Key constraint:** Custom plugin hosts are NOT on the `web_request` allowlist. Use **GET-only endpoints** to remain usable in Claude/ChatGPT consumer apps. POST is blocked in those environments.

### 4. `send_calls` Mapping
How to convert the prepare response into the `calls` array.

---

## Two Supported Response Shapes

**Envelope** (single call — Avantis-style):
```json
{
  "ok": true,
  "data": {
    "to": "0x...",
    "value": "0x0",
    "data": "0x...",
    "chainId": 8453
  }
}
```

**Ordered batch** (multi-step — Moonwell-style):
```json
{
  "transactions": [
    { "step": "approve", "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 },
    { "step": "action",  "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

Use the **ordered batch** shape when token approval must happen before the main action (staking almost always requires this).

---

## Plugin Template

````markdown
# Hydrex Plugin

> [!IMPORTANT]
> ## STOP — COMPLETE ONBOARDING BEFORE USING THIS PLUGIN
>
> Before calling any Hydrex endpoint, you MUST complete the Base MCP onboarding flow:
> 1. Call `get_wallets` (Detection)
> 2. Present wallet status and disclaimer (Onboarding)
>
> The user's wallet address — required by every prepare call — is only confirmed during Detection.

Hydrex is a <one-line description>. Fetch unsigned calldata from the Hydrex API, then execute via Base MCP's `send_calls`.

**Fetching calldata:** the Hydrex API is not on the Base MCP `web_request` allowlist. Construct prepare URLs as GET requests with all parameters in the query string. If `web_request` rejects it, fetch through whatever capability the harness exposes, or ask the user to paste the response into chat. Then continue with `send_calls`.

**Supported chain:** Base mainnet (`8453` / `0x2105`).

---

## Read endpoints

```
GET https://api.hydrex.xyz/v1/...
```

## Prepare endpoint

```
GET https://api.hydrex.xyz/v1/prepare/<action>?from=<address>&amount=<decimal>
```

Response:
```json
{
  "transactions": [
    { "step": "approve", "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 },
    { "step": "stake",   "to": "0x...", "data": "0x...", "value": "0x0", "chainId": 8453 }
  ]
}
```

## send_calls mapping

```json
{
  "chain": "base",
  "calls": [
    { "to": "<tx.to>", "value": "<tx.value>", "data": "<tx.data>" }
  ]
}
```

## Orchestration pattern

```
1. get_wallets -> address
2. GET /state/<address> -> validate balances / preconditions
3. GET /prepare/<action>?from=<address>&amount=<decimal>
4. send_calls(chain="base", calls from transactions[])
5. User approves -> get_request_status(requestId)
```
````

---

## Reference Implementations (study these)

All live in `github.com/base/skills/tree/master/skills/base-mcp/plugins/`:

| Plugin | Pattern | When to use as reference |
|---|---|---|
| `avantis.md` | Single-call envelope | Simple single-action calls |
| `moonwell.md` | Ordered batch | Approve + action atomic flows (most like staking) |
| `morpho.md` | CLI/MCP prepared batch | Complex multi-step or SDK-based flows |
| `uniswap.md` | Multi-endpoint flow | Quote → approve → swap patterns (most like routing) |

---

## Repo Strategy

**Do NOT fork `base/skills` for PRs** — their CONTRIBUTING.md states contributions are currently limited to the Base core team due to security concerns.

**Instead: create a standalone repo** (e.g. `your-org/hydrex-base-skill`).

### Repo Structure
```
hydrex-base-skill/
├── .cursor/
│   └── mcp.json                          ← wires Base MCP into Cursor automatically
├── skills/
│   └── base-mcp/
│       └── plugins/
│           └── hydrex.md                 ← the plugin spec (main deliverable)
├── README.md                             ← teammate setup instructions
```

### `.cursor/mcp.json`
```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    }
  }
}
```

### Teammate install command (for README)
```bash
npx skills add your-org/hydrex-base-skill --skill base-mcp
```

---

## How to Connect Base MCP in Cursor

Add manually to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    }
  }
}
```

Restart Cursor, then open **Settings → MCP** to confirm `base-mcp` shows as active. Auth happens on first wallet-tool use via Base Account OAuth.

---

## Next Steps Before Writing the Plugin

1. **Confirm Hydrex API access** — do they have public GET endpoints for:
   - Routing quotes (input token, output token, amount → route + calldata)
   - Staking state (address → staked balance, rewards, positions)
   - Prepare/build endpoints returning unsigned `{ to, value, data, chainId }`

2. **If no prepare endpoints exist** → you'll need a small backend (Express or FastAPI) that wraps Hydrex's SDK/contracts and exposes GET endpoints. This would be a second repo alongside the skill repo.

3. **Check chainId** — confirm Hydrex operates on Base mainnet (`8453`). If multi-chain, note which chains.

---

## Key Docs URLs

- Base MCP overview: https://docs.base.org/ai-agents
- Quickstart (connecting MCP): https://docs.base.org/ai-agents/quickstart
- Swap guide: https://docs.base.org/ai-agents/guides/swap-tokens
- Batch calls guide: https://docs.base.org/ai-agents/guides/batch-calls
- Custom plugins guide: https://docs.base.org/ai-agents/plugins/custom-plugins
- Native plugin examples: https://github.com/base/skills/tree/master/skills/base-mcp/plugins
- Base skills repo (reference only): https://github.com/base/skills