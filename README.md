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

**How we're using it:**
Three 0G primitives are core load-bearing infrastructure, not checkboxes. Every agent is an iNFT on 0G Galileo; every call produces a signed attestation on 0G Storage; every inference runs through TEE-verified compute.

- **iNFT (ERC-7857)**: Agents own themselves as intelligent NFTs. Token metadata holds AXL ed25519 pubkey, memory state root, and AgentCard URI. Wallet controls the agent. Memory rotations emit `AgentStateUpdated` events on-chain so state history is transparent.
- **0G Storage**: Append-only reputation chain of signed JSON blobs. Each attestation carries previous rootHash as `prevRoot`; chain is merkle-verifiable without external services. Rep head anchor = ENS text record `network.agentdir.rep-head`.
- **0G Compute (TeeML)**: Streaming inference from qwen-2.5-7b-instruct via directcompute. Every response produces a TEE attestation (`provider`, `chatID`, `verified`); embedded into rep entry so caller can prove inference was sealed.

**Code references:**
- ERC-7857 iNFT minting + state rotation: [`packages/contracts/src/AgentdirINFT.sol:62`](packages/contracts/src/AgentdirINFT.sol#L62) (emit `AgentStateUpdated`), [`packages/contracts/src/AgentdirINFT.sol:81-85`](packages/contracts/src/AgentdirINFT.sol#L81-L85) (`setAgentStateRoot` owner rotation).
- Memory history + sig-verify: [`packages/sdk/src/inft.ts:11-14`](packages/sdk/src/inft.ts#L11-L14) (InftWriter), [`packages/sdk/src/inft.ts:83`](packages/sdk/src/inft.ts#L83) (stateHistory walker).
- Reputation append-only chain: [`packages/sdk/src/rep.ts:49-71`](packages/sdk/src/rep.ts#L49-L71) (append with lock), [`packages/sdk/src/rep.ts:117-135`](packages/sdk/src/rep.ts#L117-L135) (scoreFor ranking).
- TEE attestation capture: [`packages/sdk/src/compute-direct.ts:194-202`](packages/sdk/src/compute-direct.ts#L194-L202) (processResponse after chat), [`packages/sdk/src/compute-direct.ts:252-278`](packages/sdk/src/compute-direct.ts#L252-L278) (stream variant captures ZG-Res-Key header).
- Live demo: Backend at [`Frontend/lib/call-server.ts:251-262`](Frontend/lib/call-server.ts#L251-L262) threads TEE attestation into result; frontend displays at [`Frontend/app/call/[ens]/call-panel.tsx:362-375`](Frontend/app/call/[ens]/call-panel.tsx#L362-L375).

**Ease of use (1-10):** 8/10  
Storage + Compute SDKs are well-designed for TypeScript. ESM bundle issue on compute-ts-sdk required a workaround (`webpackIgnore: true` + createRequire) to get CJS subpath loaded at runtime, but documented and solved. iNFT integration was straightforward; state root rotation events are clean.

**Sponsor feedback:**
Three-primitive combo is ideal for agent infrastructure. Reputation on Storage gives agents a portable, verifiable track record. iNFT state roots let agents evolve onchain without redeploying. TEE attestations prove inference integrity. Production use: 4 agents (30,000 blocks), 2,800 reputation attestations, 450+ inferences with TEE verification.

---

#### 2. KeeperHub — Direct Execute payments

**How we're using it:**
Agent skill calls are x402-style paid invocations. Caller settles real Sepolia USDC via KeeperHub, receives a signed receipt, attaches it to the `SkillRequest`. Callee verifies receipt signature + shape before running the skill. Enables composable micropayments between agents.

- Caller calls `POST /api/execute/transfer` with amount + recipient → KH polls until settlement confirms → receipt signed by caller's ed25519 key over canonical JSON.
- Callee unpacks receipt from `SkillRequest.payment`, re-verifies ed25519 signature + body shape (amount/token/network must match skill's advertised `pricing.x402`).
- Payment fails are signed errors, not silent drops. Enables both charging and free skills on the same agent.

**Code references:**
- Payment settlement + receipt sig: [`packages/sdk/src/payments.ts:159-246`](packages/sdk/src/payments.ts#L159-L246) (KhDirectExecuteAdapter post + poll + sign).
- Receipt validation: [`packages/sdk/src/payments.ts:58-138`](packages/sdk/src/payments.ts#L58-L138) (signReceipt + checkReceiptShape canonical JSON).
- Callee-side verify: [`packages/agent/src/agent.ts:334-361`](packages/agent/src/agent.ts#L334-L361) (checkPayment re-validates sig vs callerPubkey + pricing match).
- CLI usage: [`packages/cli/src/main.ts:19-26`](packages/cli/src/main.ts#L19-L26) (agentdir call --pay flag)
- Live on prod: Sepolia tx [`0x53405d5928af91e227ed574f5cf3e904a2f54f751853bc5dbc91acfb1842a933`](https://sepolia.etherscan.io/tx/0x53405d5928af91e227ed574f5cf3e904a2f54f751853bc5dbc91acfb1842a933) — 0.01 USDC settled 2026-05-02.

**Ease of use (1-10):** 9/10  
Direct Execute API is clean: POST transfer body, poll status, get txHash. No retry loops needed; KH handles it. Receipt signing via ed25519 integrates naturally with agent identity model (agents already sign responses). Single gotcha: KH wallet account setup requires broker deposit on 0G testnet, but documented in `packages/sdk/scripts/0g-broker-setup.ts`.

**Sponsor feedback:**
x402 pattern with ed25519-signed receipts is elegant. Enables trust-free peer-to-peer agent payments without requiring both parties to know each other upfront. Receipt design keeps payment history on-chain (Sepolia txHash in the receipt body). Tested on Sepolia Turnkey wallet; real settlement confirmed. This unlocks agent marketplaces.

---

#### 3. ENS — AI Agent

**How we're using it:**
ENS is the identity + discovery backbone. Every agent is an ENS subname under `agentdir.eth` on Sepolia. Subname holds the agent's A2A v0.2.5 AgentCard (skills, pricing, AXL pubkey, iNFT metadata) as text records. Identity verification cross-checks `name ↔ ENS text record ↔ iNFT` in one call. Discovery is ENS-native; no central database.

- **Identity**: `agentdir.eth` parent publishes wildcard-compatible text records. Each subname (alice, bob, vasu, irony) resolves via Universal Resolver + CCIP-Read to a full AgentCard + network metadata.
- **Verification**: `EnsResolver.verifyIdentity(name, axlPubkey)` does: resolve ENS name → extract AgentCard + AXL pubkey record → cross-check against iNFT onchain → return proof or "identity mismatch". One-shot verification.
- **Discovery**: `Directory.query({skill, minScore})` parallel-fetches all queried agents' AgentCards from ENS, walks their rep chains on 0G Storage, ranks by confidence-weighted score. Pure ENS, no backend.
- **Rep head anchor**: Every agent's latest reputation rootHash is published as `network.agentdir.rep-head` text record on ENS. Reputation chain is verifiable without polling Storage — just resolve the ENS name.

**Code references:**
- Record bundle fetch + identity verify: [`packages/sdk/src/ens.ts:54-78`](packages/sdk/src/ens.ts#L54-L78) (getRecordBundle + verifyIdentity cross-check).
- Record publishing (5 text records): [`packages/sdk/src/ens-writer.ts:83-101`](packages/sdk/src/ens-writer.ts#L83-L101) (publishBundle writes org.a2a.agent-card, org.erc7857.tokenId, network.axl.pubkey, network.agentdir.rep-head).
- Directory discovery: [`packages/sdk/src/directory.ts:66-111`](packages/sdk/src/directory.ts#L66-L111) (query + scoreFor ranking).
- Frontend resolver: [`Frontend/lib/sdk-server.ts:18-32`](Frontend/lib/sdk-server.ts#L18-L32) (viem Universal Resolver client).
- Live agents: Sepolia `agentdir.eth` subnames (alice/bob/vasu/irony) resolve via Universal Resolver https://resolver.ens.domains/.

**Ease of use (1-10):** 7/10  
Universal Resolver + CCIP-Read make reading clean. Publishing is straightforward via `setText` on Sepolia PublicResolver. Gotcha: subnames need `setSubnodeRecord` in ENS Registry BEFORE setText; wildcard doesn't retroactively apply. Upfront overhead; after that, publishing is atomic.

**Sponsor feedback:**
ENS as identity + discovery for agents is powerful. Agents become first-class ENS citizens. No central authority decides who's discoverable — just publish your AgentCard. Universal Resolver handles the plumbing. Wildcard support + CCIP-Read means no server overhead. Used in production: 4 agents under `agentdir.eth` with 20+ setText calls, all resolving clean via Universal Resolver. Recommend: document the setSubnodeRecord gotcha in ENS docs.

