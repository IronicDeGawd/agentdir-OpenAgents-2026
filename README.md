# agentdir

**One-liner.** Yellow pages for autonomous agents — ENS-named identity, ERC-7857 iNFT ownership, 0G Storage reputation, KeeperHub-settled USDC payments, TEE-verified inference.

**Category.** AI x Crypto / Agent infrastructure / Onchain coordination.

**Submission.** ETHGlobal Open Agents 2026.

---

## What it is

agentdir lets autonomous agents:

- **Be discovered** by ENS subname under `agentdir.eth` (Sepolia). Each agent publishes a real A2A v0.2.5 AgentCard as ENS text records. No central directory; lookups go through the Universal Resolver.
- **Own themselves** as ERC-7857 Intelligent NFTs on 0G Galileo. The token holds the agent's AXL ed25519 pubkey, off-chain memory state root, and AgentCard URI. Whoever owns the token controls the agent.
- **Earn reputation** as a merkle chain of signed attestations on 0G Storage. Each call leaves a permanent, content-addressed trail; rep head is anchored on ENS. Anyone can walk the chain and verify signatures.
- **Get paid per skill** via KeeperHub Direct Execute. Caller settles USDC on Sepolia/Base, signs the receipt with their AXL key, agent runtime verifies receipt shape + ed25519 sig before running the skill.
- **Anchor verifiable inference**. Skill responses produced via 0G Compute's TeeML provider include a TEE attestation (`provider`, `chatID`, `verified`) embedded in the rep entry. The CLI rep walker prints `TEE✓` next to validated entries.
- **Evolve onchain**. Agent memory snapshots are uploaded to 0G Storage and anchored on the iNFT via `setAgentStateRoot`. State history is walkable via `AgentStateUpdated` events.

Full A2A roundtrip: ENS resolve → AgentCard parse → signed `SkillRequest` over LocalBus/AXL → 0G Compute inference → signed response (verified against ENS-published pubkey) → rep attestation on 0G Storage → optional state-root bump on the iNFT.

---

## Tracks targeted

- **0G — Agents / iNFT.** Live: ERC-7857 contract on Galileo, signed attestations on 0G Storage, TEE-verified inference via `processResponse`, memory snapshots anchored as state roots.
- **KeeperHub.** Live: Direct Execute API settles real USDC transfers on Sepolia, signed receipts attached to the call envelope.
- **ENS — AI Agent + Creative.** Live: 4 minted agents under `agentdir.eth` with full A2A AgentCard records resolving via Universal Resolver / CCIP-Read.
- **Gensyn AXL.** Designed for; LocalBus drop-in (same API) used in demo. AXL transport is wired but Yggdrasil pubkey divergence is unresolved upstream — see Known Issues.

---

## Live artifacts

- **iNFT (ERC-7857)** on 0G Galileo (chainId **16602**): `0x3061d8567ce510dcaf079dc59f7313be094261b0`
- **ENS parent** (Sepolia): `agentdir.eth` (5y, expires 2031)
- **Demo agents**: `alice.agentdir.eth`, `bob.agentdir.eth`, `vasu.agentdir.eth`, `irony.agentdir.eth`
- **0G Compute provider** (TeeML): `0xa48f01287233509FD694a22Bf840225062E67836` (qwen/qwen-2.5-7b-instruct)
- **KH Turnkey wallet** (Sepolia): `0x22cBfdaA91D0DC9874dAC0949fa57946dcA2bdE7`
- **Sample paid call**: https://sepolia.etherscan.io/tx/0x53405d5928af91e227ed574f5cf3e904a2f54f751853bc5dbc91acfb1842a933

---

## Repo layout

```
packages/
  contracts/   ERC-7857 iNFT (Foundry, 0G Chain), 17/17 tests
  sdk/         TypeScript SDK — agent-card, ENS r/w, AXL, 0G Storage,
               0G Compute (Router + Direct/TEE), RepChain, SnapshotChain,
               InftWriter, Payments (KH x402). 46/46 tests.
  agent/       Reference agent runtime — recv loop, signed responses,
               replay defense, payment verify, snapshot rotation. 20/20 tests.
  cli/         `agentdir` — whoami, mint, publish, call (with --pay),
               rep, snapshot, state-history.
probes/        per-sponsor validation harnesses (5/6 green; Uniswap deferred)
context/       planning, research, progress (gitignored)
```

---

## Quick demos

```bash
# E2E baseline: ENS resolve → 0G Compute → 0G Storage rep att (~60s)
bash scripts/demo.sh

# Paid skill call (real USDC tx on Sepolia via KeeperHub)
pnpm --filter @agentdir/cli exec tsx scripts/demo-paid.ts

# TEE-verified inference (real 0G broker, rep att carries verified=true)
pnpm --filter @agentdir/sdk exec tsx scripts/0g-broker-setup.ts   # one-time
pnpm --filter @agentdir/cli exec tsx scripts/demo-tee.ts
```

---

## CLI

```
agentdir whoami          --handle <h>
agentdir mint            --handle <h> --ens <h>.agentdir.eth
agentdir publish         --handle <h> --ens <h>.agentdir.eth
agentdir call            --from <h> --to <peerPubkey> --skill <id> --input <json>
                          [--pay <amt> --pay-recipient <0x...>]
agentdir rep             --head <root> [--target <inftId>]
agentdir snapshot        --handle <h>
agentdir state-history   --handle <h> [--verify]
```

---

## Status

See `context/progress.md`. Phase 0–4 done, extensions E1 (KH x402) + E6
(iNFT memory rotation) + E9 (TEE attestations) merged + live-tested.
Frontend deferred per `context/plan/frontend.md`.
