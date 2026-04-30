# @agentdir/sdk

TypeScript SDK wrapping every primitive validated in `probes/`.

## Modules

| Module | Backing primitive | Probe |
|---|---|---|
| `agent-card` | A2A AgentCard build/parse + canonical JSON + keccak digest | offline |
| `ens` | ENS forward/reverse/text reads, Universal Resolver, identity verify | `probes/ens` ✅ |
| `axl` | AXL local HTTP bridge: topology, send, recv, MCP, A2A | `probes/axl` ✅ |
| `storage` | 0G Storage upload/download (file rootHash) | `probes/0g-storage` ✅ |
| `rep` | Append-only reputation chain on 0G Storage | derived from storage |
| `compute` | 0G Compute Router OpenAI-compat client | `probes/0g-compute` ✅ |

## Why this shape

Reputation isn't a service — it's an append-only file chain anchored by `network.agentdir.rep-head` ENS text record. Each `RepAttestation` JSON references the previous via `prevRoot`. Cheap, merkle-verifiable, no extra infra.

Identity = ENS subname + ERC-7857 iNFT + AXL ed25519 pubkey, all cross-referenced. `EnsResolver.verifyIdentity` catches spoofs in three checks.

## Tests

```
pnpm -F @agentdir/sdk test
```

Pure-TS units run without network. Integration tests in `tests/integration/` will exercise live ENS/AXL/0G.
