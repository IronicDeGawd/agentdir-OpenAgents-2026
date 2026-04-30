# Probe: Uniswap Trading API

Validates Uniswap quote API. Used only if KH→USDC settlement helper is built.

## What it checks

1. Quote endpoint reachable with API key.
2. CLASSIC quote returns valid `quote` + `methodParameters`.
3. Required headers honored (`x-universal-router-version: 2.0`).

## Why deferred priority

Only relevant if agentdir agent earns non-USDC tokens and needs auto-conversion. v1 settles in USDC directly; this probe gates v2 work.

## Run

```bash
cd probes/uniswap
UNISWAP_API_KEY=... bash probe.sh
```

Get key: https://developers.uniswap.org

## Pass criteria

All 3 checks PASS.

## Fail modes → what it tells us

- 401/403 → key not active.
- `tokenInChainId` type error → must be string, not number.
- Empty quote → token pair has no route on requested protocols; widen `protocols` array.
