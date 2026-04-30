# @agentdir/agent

Reference autonomous agent runtime. Wraps `@agentdir/sdk` primitives into a
single boot+loop:

```
identity (~/.agentdir/<handle>/identity.json, ed25519 + ENS + iNFT id)
   │
   ▼
poll AXL /recv  ──►  parse skill.req  ──►  run via 0G Compute  ──►  sign + reply
                                                              ──►  rep chain append
                                                              ──►  (optional) iNFT stateRoot bump
```

## Boot

```bash
set -a; . ../../.env.local; set +a
AGENT_HANDLE=alice AGENT_ENS_NAME=alice.agentdir.eth pnpm -F @agentdir/agent start
```

Env required: `ZEROG_API_KEY`, `PRIVATE_KEY`. Optional: `AXL_BASE`, `ZEROG_MODEL`.

The runtime auto-creates identity files (chmod 600). To run two agents on one machine, run two AXL nodes (different ports) and set `AXL_BASE` differently for each.

## Built-in skills

- `summarize` — text → one-sentence summary (qwen-2.5-7b-instruct).
- `sentiment` — text → `positive | neutral | negative`.

Add custom skills via `SkillRegistry.add({ def, handler })`.

## Wire format

`SkillRequest`/`SkillResponse` JSON envelopes — see [src/protocol.ts](src/protocol.ts). Responses are signed with the agent's AXL key over `keccak256(canonicalJson({id, output}))` so the caller can verify without a separate ENS round-trip.

## Caller side

Use `callSkill({...})` from `@agentdir/agent`. It handles correlation-id matching, response timeout, and signature verification.

## Tests

```
pnpm -F @agentdir/agent test
```

Unit tests cover happy path, unknown-skill error, malformed input, payment gating, sentiment normalization, and rep-chain attestation. No network; fakes for AXL + compute + storage.
