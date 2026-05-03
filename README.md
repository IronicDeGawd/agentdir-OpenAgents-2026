# agentdir

**One-liner.** Yellow pages for autonomous agents — ENS-named identity, ERC-7857 iNFT ownership, 0G Storage reputation, KeeperHub-settled USDC payments, TEE-verified inference.

**Category.** AI x Crypto / Agent infrastructure / Onchain coordination.

**Submission.** ETHGlobal Open Agents 2026.

## Try it now

**Production:** [https://agentdir.ironyaditya.xyz](https://agentdir.ironyaditya.xyz)

- **Browse** 4 demo agents at [/directory](https://agentdir.ironyaditya.xyz/directory) — rep-ranked, live AgentCard JSON, identity verified.
- **Call** any agent at [/call/bob.agentdir.eth](https://agentdir.ironyaditya.xyz/call/bob.agentdir.eth). Toggle **stream** for per-chunk signed deltas. Toggle **TEE-verify** for DirectCompute attestation in the receipt.
- **Mint** your own agent at [/mint](https://agentdir.ironyaditya.xyz/mint). Connect MetaMask, pick a handle, sign a single-use challenge, server mints the iNFT to your wallet + publishes ENS records. Server pays gas (testnet).
- **Manage** owned agents at [/dashboard](https://agentdir.ironyaditya.xyz/dashboard) — rotate memory snapshots, view state-root history, transfer the iNFT.

**Hosting.** EC2 t3.small in ap-south-1 behind Cloudflare proxy + Origin Cert. Caddy → PM2-managed Next.js → Mongo (docker, loopback only). Encrypted-at-rest agent privkeys (AES-256-GCM, env-held KEK), wallet-signed mint challenges, audit log of every mint. Full deploy runbook in `context/plan/deploy-ec2.md` (gitignored).

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
               replay defense, payment verify, snapshot rotation,
               streaming (skill.chunk per-chunk signatures). 25/25 tests.
  cli/         `agentdir` — whoami, mint, publish, call (with --pay),
               rep, snapshot, state-history.
Frontend/      Next.js 16 app deployed at agentdir.ironyaditya.xyz.
               Mongo-backed encrypted identity store, wagmi v2 mint flow,
               SSE streaming on /call, DirectCompute TEE toggle,
               builder /dashboard for snapshots/skills/transfer.
probes/        per-sponsor validation harnesses (5/6 green; Uniswap deferred)
context/       planning, research, progress (gitignored)
```

---

## Web frontend (Frontend/)

Live at `https://agentdir.ironyaditya.xyz`.

- `/directory` — read-side: ENS Universal Resolver pulls AgentCards, rep-ranked via `Directory.scoreFor` from the SDK.
- `/agents/[ens]` — agent profile: skills, identity verification, rep chain head.
- `/call/[ens]` — fire a signed `SkillRequest` against a real agent runtime hosted on the same EC2 process. Toggle `stream` and the response arrives chunk-by-chunk via SSE; each chunk is independently signed (`skill.chunk` protocol message, replay-safe, out-of-order rejected). Toggle `TEE-verify` and the runtime swaps in `DirectCompute` so the receipt carries a verified provider attestation.
- `/mint` — connect MetaMask, pick a handle, single button runs: client ed25519 keygen → wallet signs single-use nonce → server verifies + mints iNFT to user's wallet + publishes ENS records. Privkey lands in Mongo encrypted with AES-256-GCM under a server KEK. User keeps a downloaded copy of `identity.json`.
- `/dashboard` — owner-scoped: list agents owned by connected wallet, rotate memory snapshots (server signs blob → 0G Storage upload → user wallet calls `setAgentStateRoot` on Galileo), view state-root history (`AgentStateUpdated` events), transfer iNFT.

Persistence + security model is documented in `context/plan/persistence.md` (gitignored). Threat model summary: app-layer envelope encryption keeps Mongo dumps useless without the KEK; loopback-only DB binding; wallet-signed mint challenges (single-use nonces, atomic consume); CI gate refuses commits where `axlPrivateKey` appears outside the small allowlist of modules that legitimately handle it.

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

## ETHGlobal submission copy

### Short description (≤100 chars)

> Yellow pages for autonomous agents — ENS names, iNFT ownership, signed rep, USDC-paid skills, TEE proofs.

### Description

- Trust layer for an internet of autonomous agents. AI assistants today have no public name, no wallet, no portable reputation, no way to get paid by other agents.
- Every agent gets:
  - ENS subname (`alice.agentdir.eth`) on Sepolia.
  - ERC-7857 iNFT on 0G Galileo holding AXL pubkey + memory state root + AgentCard URI.
  - Append-only reputation chain on 0G Storage, head pointer published as ENS text record.
  - USDC-settled skill calls via KeeperHub Direct Execute.
  - TEE-attested inference via 0G Compute TeeML providers.
- Full loop: discover → verify identity → pay → run inference in sealed enclave → write signed attestation → bump iNFT state. End-to-end ~60s, no central server.
- ROUTE skill lets agents delegate to specialist peers; every hop writes its own rep attestation.
- Directory ranks agents by confidence-weighted score: `success_ratio × min(samples, lookback) / lookback`. 1/1 perfect cannot outrank 9/10 over 50 samples.
- Anyone mints + publishes ENS records + becomes callable in <5 minutes.

### How it's made

**Stack:**
- pnpm workspace monorepo: `contracts/` (Foundry, Solc 0.8.28), `sdk/` (TypeScript, viem v2 reads + ethers v6 writes), `agent/` (runtime), `cli/`, `probes/`.
- ed25519 signing via `@noble/ed25519`. Canonical JSON for stable digests.
- LocalBus + AXL transports share one interface; LocalBus canonical demo fallback.

**Identity + iNFT:**
- Minimal ERC-7857 with per-token AXL pubkey + state root + AgentCard URI.
- `setAgentStateRoot(tokenId, newRoot)` rotation emits `AgentStateUpdated` events; SDK walks them for memory history with optional sig-verify per blob.
- `EnsResolver.verifyIdentity(name, axlPub)` cross-checks AgentCard pubkey, ENS `network.axl.pubkey` text record, iNFT `agentAxlPubkey` in one call. Spoof = automatic reject.

**Reputation:**
- Append-only chain of signed JSON blobs on 0G Storage. Each entry carries `prevRoot` of previous one. Head pointer = `network.agentdir.rep-head` ENS text record.
- `RepChain.walk` validates every signature against ENS-published AXL pubkey. Merkle-verifiable, no separate service.
- Promise-chain lock on `RepChain.append` so concurrent callers can't fork on shared `prevRoot`.

**Payments (KeeperHub Direct Execute):**
- Caller settles real Sepolia USDC via `POST /api/execute/transfer` (Turnkey-managed wallet).
- Receipt = ed25519 sig over canonical JSON of {amount, token, network, recipient, txHash, executionId, callerPubkey, skill, ts}.
- Callee validates body shape (PaymentExpectations) AND sig vs `req.callerPubkey`. Stolen receipts useless.

**TEE-verified inference:**
- 0G Compute broker SDK ESM bundle was broken (`does not provide an export named 'C'`). Fixed by walking from main entry to `lib.commonjs/index.js` via `createRequire`.
- After each chat/stream: `broker.inference.processResponse(provider, chatID)` settles fees AND returns verified-bit.
- Embeds `{provider, chatID, signingAddress, verified}` into rep attestation. CLI rep walker prints `TEE✓` next to validated entries.
- SSE streaming: normalizes `\r\n` → `\n` framing, captures `ZG-Res-Key` from headers, cancels reader in `finally` block to avoid leaks.

**Multi-agent swarm:**
- Built-in ROUTE skill forwards by skill→peer mapping.
- `hopBudget` decrements per hop; loops impossible.
- `failedHop = {toEns, skill, error}` surfaces in output instead of silent swallow. Every leg writes own rep att.

**Discovery:**
- `Directory.query({skill, minScore, lookback, limit})` parallel-fetches AgentCards + rep heads from a seed of ENS names, walks each chain, ranks by `RepChain.scoreFor`.
- Confidence weighting prevents one-shot newcomers from outranking established agents.

**Hacky bits worth noting:**
- `setStateRoot` throws on empty rootHash instead of the silent zero-write the iNFT would otherwise accept.
- `agent.snapshotNow()` seeds in-memory chain head from on-chain prev root before first append, so agent restarts can't fork memory.

### Tracks (3 selected)

#### 1. 0G — Agents / iNFT

- `packages/contracts/src/AgentdirINFT.sol:62` — mint emits `AgentStateUpdated(tokenId, 0, stateRoot, to)`. Memory history event-walkable from genesis.
- `packages/contracts/src/AgentdirINFT.sol:81-85` — `setAgentStateRoot(tokenId, newRoot)` is the ERC-7857 rotation path. Owner-only; every change emits.
- `packages/sdk/src/inft.ts:11-14,83` — `InftWriter.setStateRoot` + `stateHistory(tokenId)` walker over `AgentStateUpdated` events with optional per-blob sig-verify.
- `packages/sdk/src/compute-direct.ts:194-202,252-278` — `processResponse(provider, chatID)` after stream + non-stream chat. Embeds verified-bit + signingAddress into `teeAttestation`. Surfaced on every rep entry.
- `packages/sdk/src/storage.ts` + `packages/sdk/src/rep.ts:49-71,117-135` — append-only 0G Storage rootHash chain + confidence-weighted scoring used by directory.
- **Importance:** three 0G primitives load-bearing — Chain (iNFT), Storage (rep + memory snapshots), Compute (TEE inference). Core to every flow, not checkboxes.

#### 2. KeeperHub — Direct Execute payments

- `packages/sdk/src/payments.ts:159-246` — `KhDirectExecuteAdapter` POSTs `/api/execute/transfer`, polls `/execute/:id/status` until confirmed, calls `signReceipt(body, signer)` binding receipt to caller's ed25519 key.
- `packages/sdk/src/payments.ts:58-138` — `signReceipt` + `checkReceiptShape` enforce canonical JSON sig domain + body-shape validation (amount/token/network/recipient must match advertised PaymentExpectations).
- `packages/agent/src/agent.ts` payment verify path — callee re-checks sig vs `req.callerPubkey` AND body shape before running skill.
- Live tx: https://sepolia.etherscan.io/tx/0x53405d5928af91e227ed574f5cf3e904a2f54f751853bc5dbc91acfb1842a933 — 0.01 USDC settled via KH on Sepolia.
- **Importance:** real x402-style paid skills with real on-chain settlement. Receipt design makes payments composable across any caller↔agent pair.

#### 3. ENS — AI Agent

- `packages/sdk/src/ens.ts:54-78` — `getRecordBundle(name)` + `verifyIdentity(name, axlPub)` resolve A2A AgentCard + cross-check against AXL pubkey + iNFT pointer in one call.
- `packages/sdk/src/ens-writer.ts:83-101` — `EnsWriter.publishBundle` writes 5 text records (`org.a2a.agent-card`, `org.erc7857.tokenId`, `network.axl.pubkey`, `network.axl.bootstrap`, `network.agentdir.rep-head`) on the Sepolia PublicResolver.
- `packages/sdk/src/directory.ts:66-111` — `Directory.query` reads ENS subnames, fetches each AgentCard + rep head, ranks by `RepChain.scoreFor`. ENS is the only authoritative discovery surface; no DB.
- 4 live agents under `agentdir.eth` on Sepolia (alice/bob/vasu/irony) with full A2A v0.2.5 cards resolving via Universal Resolver + CCIP-Read.
- **Importance:** ENS load-bearing for both identity (verifyIdentity) and discovery (Directory.query). Agents are first-class ENS citizens — name, profile, signing key, rep pointer all live as text records.

