// Agent runtime: poll AXL /recv → execute skill → reply → attest.
// One Agent instance owns one identity (one AXL key + one ENS name +
// one iNFT). Multiple agents per process are supported; each gets a
// distinct AxlClient base url if you run multiple AXL nodes locally.

import { keccak256, toHex } from "viem";
import {
  AxlClient,
  Compute,
  RepChain,
  Storage,
  canonicalJson,
} from "@agentdir/sdk";
import type { AgentIdentity } from "./identity.js";
import { signDigest } from "./identity.js";
import { SkillRegistry } from "./skills.js";
import {
  isSkillRequest,
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
};

export class Agent {
  private running = false;

  constructor(public readonly opts: AgentOpts) {}

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

  private async handleSkillRequest(fromPubkey: string, req: SkillRequest): Promise<void> {
    const t0 = Date.now();
    const reg = this.opts.skills.get(req.skill);
    if (!reg) {
      await this.replyErr(fromPubkey, req.id, `unknown skill: ${req.skill}`);
      return;
    }

    if (this.opts.requirePayment && !req.payment) {
      await this.replyErr(fromPubkey, req.id, "payment-required");
      return;
    }

    let output: unknown;
    let ok = true;
    try {
      output = await reg.handler(req.input, { compute: this.opts.compute });
    } catch (e: any) {
      ok = false;
      await this.replyErr(fromPubkey, req.id, e?.message ?? "skill failed");
    }

    if (ok) {
      await this.replyOk(fromPubkey, req.id, output);
    }

    // Attest. Even failed calls get attested so reputation reflects reliability.
    await this.attest({
      callerINFT: req.callerINFT ?? "0",
      ok,
      latencyMs: Date.now() - t0,
      skill: req.skill,
    });
  }

  private async replyOk(to: string, id: string, output: unknown): Promise<void> {
    const digest = keccak256(toHex(canonicalJson({ id, output })));
    const sig = await signDigest(this.opts.identity, digest);
    const res: SkillResponse = {
      v: 1,
      type: "skill.res",
      id,
      ok: true,
      output,
      sig,
      signerPubkey: this.opts.identity.axlPubkeyHex,
    };
    await this.opts.axl.sendJson(to, res);
  }

  private async replyErr(to: string, id: string, error: string): Promise<void> {
    const res: SkillResponse = { v: 1, type: "skill.res", id, ok: false, error };
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
