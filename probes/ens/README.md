# Probe: ENS

Validates ENS primitives `agentdir` depends on.

## What it checks

1. Forward resolve `nick.eth` on mainnet → returns address (sanity / Universal Resolver works).
2. Read text record `com.twitter` from `nick.eth` (text record reads).
3. Read multichain coinType (Base address for `gregskril.eth` — multichain support).
4. Round-trip an A2A AgentCard JSON through a text-record-shape blob (offline; verifies our card shape fits ENS).
5. Reverse resolve a known address → primary name.
6. Verify Universal Resolver via `ur.integration-tests.eth` returning `0x2222...`.
7. (Optional, gated by `WRITE=1`) Write `org.a2a.agent-card` to a Sepolia test name we own, read it back.

## Why these

- agentdir publishes A2A card + AXL pubkey + iNFT tokenId + rep stream id as text records → reads must be reliable.
- Multichain coinType reads = future-proofing for L2 settlement display.
- Reverse + forward verification = the spoofing defense we promised.

## Run

```bash
cd probes/ens
pnpm install
pnpm tsx probe.ts                  # read-only
WRITE=1 PRIVATE_KEY=0x... ENS_NAME=youragent.yourname.eth pnpm tsx probe.ts
```

## Pass criteria

All 6 read checks PASS. Card-shape JSON round-trips byte-equal. Optional write check PASS if invoked.

## Fail modes → what it tells us

- Universal Resolver test returns wrong address → viem too old; bump to >=2.35.0.
- Text record read returns null on `nick.eth` → RPC endpoint dropping CCIP Read.
- Card JSON > some size limit on chain write → switch to NameStone offchain subnames.
