#!/usr/bin/env bash
# End-to-end agentdir demo. ~90 seconds.
#
#   1. Two persistent agent identities (alice, bob) loaded from ~/.agentdir.
#   2. Alice resolves bob.agentdir.eth on Sepolia ENS — recovers AXL pubkey,
#      iNFT id, and the A2A AgentCard.
#   3. Bob's agent runtime starts in-process on a LocalBus.
#   4. Alice calls bob's `summarize` skill; bob runs inference on 0G Compute,
#      signs the response, alice verifies the sig vs the ENS-published key.
#   5. Bob writes a signed RepAttestation to 0G Storage. RootHash printed.
#
# Pre-reqs (one-time):
#   - .env.local with PRIVATE_KEY, ZEROG_API_KEY (already done if you ran setup).
#   - alice + bob iNFTs minted on 0G Galileo (already minted; tokens #1, #2).
#   - alice + bob ENS records published on Sepolia (already published).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/cli"
exec pnpm exec tsx scripts/demo-e2e.ts
