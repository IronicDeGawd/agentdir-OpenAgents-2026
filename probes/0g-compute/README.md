# Probe: 0G Compute (Router)

Validates 0G Compute Router primitives — the inference backend for agent skills.

## What it checks

1. Router base URL reachable.
2. Chat completion against `zai-org/GLM-5-FP8` returns text.
3. Streaming chat completion yields chunks.
4. Auth header rejected when missing/invalid (401).

## Why these

- Every agent skill call runs an LLM via 0G Compute. If router unreliable, agents stall.
- Streaming = future UX concern but cheap to verify.

## Run

```bash
cd probes/0g-compute
pnpm install
ZEROG_API_KEY=sk-... pnpm tsx probe.ts
```

Get key: https://pc.testnet.0g.ai → Dashboard → API Keys → `inference` permission.

## Pass criteria

All 4 checks PASS.

## Fail modes → what it tells us

- 401 with valid key → key revoked or wrong network endpoint.
- 429 rate limit → too aggressive; back off and retry.
- Empty completion → model OOM; pick smaller model.
