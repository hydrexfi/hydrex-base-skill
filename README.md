# hydrex-base-skill

A [Base MCP](https://docs.base.org/ai-agents) plugin for [Hydrex](https://hydrex.fi) on Base. It lets AI assistants quote swaps, read portfolio state, and submit stake/unstake/claim transactions through the user's Base Account wallet.

## What it does

The plugin covers Hydrex routing and LP gauge actions on Base mainnet (chain ID `8453`):

- **Swaps** — quotes and execution via the public Hydrex Router API
- **Staking** — stake, unstake, and claim gauge rewards
- **Read state** — portfolio balances, positions, and trade history

Write actions go through Base MCP's `send_calls` tool. The user approves each batch in their wallet.

## How it works

Base MCP plugins are markdown specs that tell an assistant which APIs to call and how to turn the response into onchain calls. This repo has two parts:

1. **`skills/base-mcp/plugins/hydrex.md`** — the plugin spec. It defines onboarding (wallet lookup via `get_wallets`), read endpoints, prepare endpoints, and the mapping to `send_calls`.

2. **`server/`** — an Express server that serves GET endpoints for state and unsigned transaction calldata. Staking flows need this server because custom hosts are not on Base MCP's `web_request` allowlist. Swap quotes can call the Hydrex Router API directly.

Typical flow:

```
get_wallets → read state (quote or portfolio) → GET prepare endpoint → send_calls → get_request_status
```

Prepare endpoints return an ordered list of transactions (e.g. approve then stake). The plugin passes each item's `to`, `data`, and `value` into a single `send_calls` batch on chain `"base"`.

## Layout

```
skills/base-mcp/plugins/hydrex.md   plugin spec
server/                             prepare and state API
.cursor/mcp.json                    Base MCP connection for Cursor
```

Setup, endpoint reference, and build notes are in [BUILD.md](BUILD.md).
