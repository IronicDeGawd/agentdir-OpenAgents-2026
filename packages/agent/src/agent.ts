// Agent runtime: poll AXL /recv → execute skill → reply (signed) → attest.
// One Agent instance owns one identity (one AXL key + one ENS name +
// one iNFT). Multiple agents per process are supported; each gets a
// distinct AxlClient base url if you run multiple AXL nodes locally.

import { keccak256, toHex } from "viem";
import {
  AxlClient,
  Compute,
  InftWriter,
  RepChain,
  SnapshotChain,
  Storage,
  canonicalJson,
  checkReceiptShape,
  verifyReceipt,
  type MemorySnapshot,
  type PaymentExpectations,
  type SkillStats,
} from "@agentdir/sdk";
import type { AgentIdentity } from "./identity.js";
import { signDigest } from "./identity.js";
import { SkillRegistry, type RegisteredSkill } from "./skills.js";
import {
  isSkillRequest,
  type ResponseSigDomain,
  type SkillRequest,
  type SkillResponse,
} from "./protocol.js";

export type AgentOpts = {
  identity: AgentIdentity;
  axl: AxlClient;
  compute: Compute;
  storage?: Storage; // optional — required to write rep attestations
  rep?: RepChain;
  skills: SkillRegistry;
  /** When true, skill responses include a payment-required err if no payment present. */
  requirePayment?: boolean;
  /** Max age (ms) for incoming SkillRequest.ts; default 30s. */
  maxRequestAgeMs?: number;
  /** LRU size for nonce dedup; default 4096. */
  nonceCacheSize?: number;
  /** Snapshot chain — required when snapshotEvery > 0. */
  snapshots?: SnapshotChain;
  /** INFT writer for anchoring snapshot root on-chain. */
  inft?: InftWriter;
  /** Auto-snapshot every N successful calls. 0 disables (default). */
  snapshotEvery?: number;
  /** Payment receipt expectations (skill pricing comes from skill.def). */
  paymentExpectations?: {
    /** Callee's EVM address — recipient field on receipt. */
    recipient: string;
    /** Token address (ERC-20) we expect payment in. */
    tokenAddress: string;
    /** Chain id, decimal string. */
    network: string;
    /** Receipt freshness window in ms. Default 5 min. */
    maxAgeMs?: number;
  };
};

export class Agent {
  private running = false;
  private seenNonces: Map<string, number> = new Map();
  private callsTotal = 0;
  private okTotal = 0;
  private skillStats: SkillStats = {};
  private snapshotInFlight: Promise<unknown> | null = null;

  constructor(public readonly opts: AgentOpts) {}

  /** Read-only stats snapshot for callers (CLI, tests). */
  stats() {
    return {
      callsTotal: this.callsTotal,
      okTotal: this.okTotal,
      skillStats: { ...this.skillStats },
    };
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const m = await this.opts.axl.recvOnce();
        if (!m) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        await this.handleInbound(m.from, m.body);
      } catch (e: any) {
        // Don't let a single bad request kill the loop.
        // eslint-disable-next-line no-console
        console.error("[agent] inbound error:", e?.message ?? e);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  /** Public for tests + CLI: handle one already-received message. */
  async handleInbound(fromPubkey: string, body: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return; // not JSON; ignore (could be raw send/recv from other apps)
    }
    if (!isSkillRequest(parsed)) return;
    await this.handleSkillRequest(fromPubkey, parsed);
  }

  private rejectStale(req: SkillRequest): string | null {
    const max = this.opts.maxRequestAgeMs ?? 30_000;
    const skew = Date.now() - req.ts;
    if (Math.abs(skew) > max) return `stale: ${skew}ms`;
    if (this.seenNonces.has(req.nonce)) return "replay";
    this.seenNonces.set(req.nonce, Date.now());
    // bounded LRU
    const cap = this.opts.nonceCacheSize ?? 4096;
    if (this.seenNonces.size > cap) {
      const oldest = this.seenNonces.keys().next().value;
      if (oldest !== undefined) this.seenNonces.delete(oldest);
    }
    return null;
  }

  /** Lightweight runtime validation against the skill's inputSchema. Only
   *  enforces required + maxLength on string fields — not a full JSON Schema
   *  engine but stops the obvious DoS vectors. */
  private validateInput(reg: RegisteredSkill, input: any): string | null {
    const schema: any = reg.def.inputSchema ?? {};
    if (input === null || typeof input !== "object") return "input must be object";
    for (const k of (schema.required as string[] | undefined) ?? []) {
      if (!(k in input)) return `missing required field: ${k}`;
    }
    const props = schema.properties as Record<string, any> | undefined;
    if (!props) return null;
    for (const [k, prop] of Object.entries(props)) {
      const v = input[k];
      if (v === undefined) continue;
      if (prop.type === "string") {
        if (typeof v !== "string") return `field ${k} must be string`;
        if (typeof prop.maxLength === "number" && v.length > prop.maxLength)
          return `field ${k} exceeds maxLength=${prop.maxLength}`;
      }
    }
    return null;
  }

  /**
   * Verify the payment receipt on a request. Returns null on pass, or a
   * short reason on rejection. Three things are checked:
   *   1. Receipt is present.
   *   2. Receipt body matches expectations (amount, token, network,
   *      recipient, callerPubkey, skill, freshness).
   *   3. ed25519 sig over the receipt body verifies under callerPubkey.
   *
   * NOTE: We do NOT do an onchain readback in v1. The KH execution returned
   * a real tx, the caller signed the receipt referencing that tx, and the
   * sig binds the receipt to the AXL identity that the rest of the call
   * is bound to. Onchain readback can be layered on without protocol change.
   */
  private async checkPayment(
    req: SkillRequest,
    reg: RegisteredSkill,
    pricing?: { token: string; chainId: number; amount: string }
  ): Promise<string | null> {
    if (!req.payment) return "no receipt";
    const exp = this.opts.paymentExpectations;
    if (!exp) return "agent missing paymentExpectations config";

    // Pricing came from the skill def if present; else fall back to
    // any single advertised price (can't cross-check amount otherwise).
    const expectedAmount = pricing?.amount ?? req.payment.amount;
    const expectedToken = pricing?.token === "USDC" ? exp.tokenAddress : exp.tokenAddress;

    const expectations: PaymentExpectations = {
      amount: expectedAmount,
      tokenAddress: expectedToken,
      network: exp.network,
      recipient: exp.recipient,
      callerPubkey: req.callerPubkey,
      skill: reg.def.id,
      maxAgeMs: exp.maxAgeMs,
    };
    const shapeErr = checkReceiptShape(req.payment, expectations);
    if (shapeErr) return shapeErr;
    const sigOk = await verifyReceipt(req.payment, req.callerPubkey);
    if (!sigOk) return "bad receipt sig";
    return null;
  }

  private async handleSkillRequest(fromPubkey: string, req: SkillRequest): Promise<void> {
    const t0 = Date.now();
    const stale = this.rejectStale(req);
    if (stale) {
      await this.replyErr(fromPubkey, req, `request rejected: ${stale}`);
      return;
    }
    // The request claims callerPubkey; AXL doesn't strictly enforce sender
    // identity matches the claim, so we record both. The fromPubkey is the
    // AXL-level peer; callerPubkey is what the caller wants the responder
    // to bind into the response sig.
    if (req.callerPubkey.toLowerCase() !== fromPubkey.toLowerCase()) {
      await this.replyErr(fromPubkey, req, "caller pubkey mismatch");
      return;
    }
    const reg = this.opts.skills.get(req.skill);
    if (!reg) {
      await this.replyErr(fromPubkey, req, `unknown skill: ${req.skill}`);
      return;
    }
    // Payment gate. Enforced only when requirePayment is set; pricing on
    // the skill def is advertisement, not policy. When enforced, the
    // expected amount comes from the skill's pricing.x402 field if present,
    // else the receipt's amount is accepted as-is (no upper bound check).
    if (this.opts.requirePayment === true) {
      const pricing = (reg.def.pricing as any)?.x402 as
        | { token: string; chainId: number; amount: string }
        | undefined;
      const reason = await this.checkPayment(req, reg, pricing);
      if (reason) {
        await this.replyErr(fromPubkey, req, `payment-rejected: ${reason}`);
        return;
      }
    }
    const inputErr = this.validateInput(reg, req.input);
    if (inputErr) {
      await this.replyErr(fromPubkey, req, `invalid input: ${inputErr}`);
      return;
    }

    let output: unknown;
    let ok = true;
    try {
      output = await reg.handler(req.input, { compute: this.opts.compute });
    } catch (e: any) {
      ok = false;
      await this.replyErr(fromPubkey, req, e?.message ?? "skill failed");
    }

    if (ok) {
      await this.replyOk(fromPubkey, req, output);
    }

    // Attest. Even failed calls get attested so reputation reflects reliability.
    await this.attest({
      callerINFT: req.callerINFT ?? "0",
      ok,
      latencyMs: Date.now() - t0,
      skill: req.skill,
    });

    this.bumpStats(req.skill, ok);
    this.maybeSnapshot();
  }

  private bumpStats(skill: string, ok: boolean): void {
    this.callsTotal += 1;
    if (ok) this.okTotal += 1;
    const cur = this.skillStats[skill] ?? { calls: 0, ok: 0 };
    cur.calls += 1;
    if (ok) cur.ok += 1;
    else cur.errLastTs = Math.floor(Date.now() / 1000);
    this.skillStats[skill] = cur;
  }

  /** Fire-and-forget snapshot rotation if threshold hit. Skips overlapping rotations. */
  private maybeSnapshot(): void {
    const every = this.opts.snapshotEvery ?? 0;
    if (every <= 0) return;
    if (this.callsTotal % every !== 0) return;
    if (this.snapshotInFlight) return; // skip; previous still running
    this.snapshotInFlight = this.snapshotNow().catch((e: any) => {
      // eslint-disable-next-line no-console
      console.error("[agent] snapshot rotation failed:", e?.message ?? e);
    }).finally(() => {
      this.snapshotInFlight = null;
    });
  }

  /**
   * Force an immediate snapshot. Uploads memory blob to 0G Storage, then
   * (if InftWriter present) anchors root on-chain via setAgentStateRoot.
   * Returns the new snapshot rootHash (or null if no snapshot chain configured).
   *
   * On first call after process start, seeds the snapshot chain head from
   * the on-chain prev root so the chain stays linked across restarts.
   */
  async snapshotNow(): Promise<{ root: string; snapshot: MemorySnapshot; txHash?: string } | null> {
    if (!this.opts.snapshots) return null;
    const tokenId = this.opts.identity.inftTokenId;
    if (!tokenId) throw new Error("identity.inftTokenId required for snapshot");

    // Seed chain head from on-chain root if our local chain is empty AND
    // the contract has a non-zero prev root. Prevents fork on agent restart.
    if (this.opts.snapshots.head === null && this.opts.inft) {
      try {
        const prev = await this.opts.inft.getStateRoot(tokenId);
        const ZERO = "0x" + "00".repeat(32);
        if (prev && prev !== ZERO) this.opts.snapshots.head = prev;
      } catch {
        // RPC failure is non-fatal — proceed as genesis.
      }
    }

    const repHead = this.opts.rep?.head ?? null;
    const { root, snapshot } = await this.opts.snapshots.append({
      ensName: this.opts.identity.ensName,
      signerPubkey: this.opts.identity.axlPubkeyHex,
      inftTokenId: tokenId,
      callsTotal: this.callsTotal,
      okTotal: this.okTotal,
      skillStats: { ...this.skillStats },
      repHead,
      signer: (digest) => signDigest(this.opts.identity, digest),
    });
    let txHash: string | undefined;
    if (this.opts.inft) {
      txHash = await this.opts.inft.setStateRoot(tokenId, root);
    }
    return { root, snapshot, txHash };
  }

  private async signResponse(d: ResponseSigDomain): Promise<string> {
    const digest = keccak256(toHex(canonicalJson(d)));
    return signDigest(this.opts.identity, digest);
  }

  private async replyOk(to: string, req: SkillRequest, output: unknown): Promise<void> {
    const ts = Date.now();
    const responder = this.opts.identity.axlPubkeyHex;
    const domain: ResponseSigDomain = {
      v: 1,
      id: req.id,
      ok: true,
      output,
      responder,
      caller: req.callerPubkey,
      skill: req.skill,
      ts,
    };
    const sig = await this.signResponse(domain);
    const res: SkillResponse = {
      v: 1,
      type: "skill.res",
      id: req.id,
      ok: true,
      output,
      ts,
      responder,
      caller: req.callerPubkey,
      skill: req.skill,
      sig,
      signerPubkey: responder,
    };
    await this.opts.axl.sendJson(to, res);
  }

  private async replyErr(to: string, req: SkillRequest, error: string): Promise<void> {
    const ts = Date.now();
    const responder = this.opts.identity.axlPubkeyHex;
    const domain: ResponseSigDomain = {
      v: 1,
      id: req.id,
      ok: false,
      error,
      responder,
      caller: req.callerPubkey,
      skill: req.skill,
      ts,
    };
    const sig = await this.signResponse(domain);
    const res: SkillResponse = {
      v: 1,
      type: "skill.res",
      id: req.id,
      ok: false,
      error,
      ts,
      responder,
      caller: req.callerPubkey,
      skill: req.skill,
      sig,
      signerPubkey: responder,
    };
    await this.opts.axl.sendJson(to, res);
  }

  private async attest(input: {
    callerINFT: string;
    ok: boolean;
    latencyMs: number;
    skill: string;
  }): Promise<void> {
    if (!this.opts.rep) return;
    const calleeINFT = this.opts.identity.inftTokenId ?? "0";
    await this.opts.rep.append({
      callerINFT: input.callerINFT,
      calleeINFT,
      skill: input.skill,
      ok: input.ok,
      latencyMs: input.latencyMs,
      signer: (digest) => signDigest(this.opts.identity, digest),
    });
  }
}
