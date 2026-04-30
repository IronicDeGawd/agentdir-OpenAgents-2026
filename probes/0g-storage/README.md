# Probe: 0G Storage

Validates 0G Storage primitives `agentdir` uses for agent memory + reputation stream.

## What it checks

1. Indexer reachable.
2. In-memory blob upload returns rootHash.
3. Download by rootHash matches original bytes (merkle proof verified).
4. KV stream `set` then `get` returns same value (the rep-stream primitive).
5. Encryption (AES-256) upload + decrypt round-trip.

## Why these

- Agent memory persists in 0G Storage; rootHash anchored in iNFT `agentStateRoot`.
- Reputation attestations append to KV stream — this IS the rep system.
- Encryption optional but useful for private agent memory.

## Run

```bash
cd probes/0g-storage
pnpm install
PRIVATE_KEY=0x... pnpm tsx probe.ts
```

Wallet must be funded on Galileo testnet (https://faucet.0g.ai, 0.1 0G/day).

## Pass criteria

Checks 1–4 PASS. Encryption check PASS or SKIP if SDK version mismatch.

## Fail modes → what it tells us

- Indexer unreachable → testnet down; switch to standard indexer URL.
- Upload fails with "insufficient funds" → faucet wallet, retry.
- KV `get` returns null → batcher not flushed; raise wait time or use sync API if available.
