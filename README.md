# agentdir

Onchain agent directory + reputation + payments layer.
ETHGlobal Open Agents 2026.

Tracks targeted: Gensyn AXL, ENS (AI Agent + Creative), 0G (Agents/iNFT + Framework stretch), KeeperHub.

## Structure

```
packages/
  contracts/   ERC-7857 iNFT + reverse-claim verifier (Foundry, 0G Chain)
  sdk/         agentdir TypeScript SDK (publish/resolve A2A card, rep stream, x402)
  agent/       reference agent runtime (autonomous earner)
  cli/         agentdir CLI (mint, register, query, demo)
probes/        per-sponsor validation harnesses (run before building on top)
tests/         cross-component integration tests
scripts/       deploy + demo orchestration
context/       internal planning, research, progress (gitignored)
```

## Quickstart

See `context/plan/agentdir.md` once probes are green.

## Phase 0: protocol probes

```
pnpm probe:ens          # ENS read/write text records, A2A card publish
pnpm probe:axl          # two AXL nodes, send + MCP roundtrip
pnpm probe:0g-storage   # upload/download + KV stream append
pnpm probe:0g-compute   # router-api OpenAI-compat call
pnpm probe:keeperhub    # MCP workflow create/execute
pnpm probe:uniswap      # quote API
```

Each probe must pass before its primitive is wired into `packages/sdk`.
