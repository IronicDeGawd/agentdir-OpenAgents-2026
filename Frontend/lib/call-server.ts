import "server-only";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  Compute,
  DirectCompute,
  RepChain,
  Storage,
  makeSigner,
} from "@agentdir/sdk";
import {
  Agent,
  LocalBusClient,
  callSkill,
  callSkillStream,
  SkillRegistry,
  SUMMARIZE,
  SENTIMENT,
  makePromptSkill,
} from "@agentdir/agent";
import { getEnsResolver, getStorage } from "./sdk-server";
import { loadIdentity, markBooted } from "./identity-store";
import { listPromptSkills } from "./prompt-skills";
import { parseAgentCard } from "@agentdir/sdk/agent-card";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

const ZG_RPC = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

// Per-callee runtimes, keyed `<ens>` for normal mode and `<ens>:tee` for the
// DirectCompute (TEE-attested) variant. LocalBus is process-global so the
// caller can reach either bus the same way.
type CalleeRuntime = {
  handle: string;
  ens: string;
  agent: Agent;
  bus: LocalBusClient;
  identity: Awaited<ReturnType<typeof loadIdentity>>;
  rep: RepChain;
  compute: Compute | DirectCompute;
  tee: boolean;
};

const runtimes = new Map<string, CalleeRuntime>();

function ensToHandle(ens: string): string {
  const first = ens.split(".")[0];
  if (!first) throw new Error("invalid ens");
  return first;
}

async function buildCompute(useTee: boolean): Promise<Compute | DirectCompute> {
  if (!process.env.ZEROG_API_KEY) {
    throw new Error("ZEROG_API_KEY missing on server");
  }
  if (!useTee) {
    return new Compute({
      apiKey: process.env.ZEROG_API_KEY,
      network: "testnet",
      model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
    });
  }
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing — needed for DirectCompute broker auth");
  const provider = process.env.ZEROG_PROVIDER;
  if (!provider) throw new Error("ZEROG_PROVIDER env missing for TEE mode");
  const signer = makeSigner(pk, ZG_RPC);
  // ethers Wallet returned; DirectCompute accepts Wallet | JsonRpcSigner.
  return DirectCompute.create({ signer: signer as any, provider });
}

async function bootCallee(ens: string, useTee: boolean): Promise<CalleeRuntime> {
  const key = useTee ? `${ens}:tee` : ens;
  const cached = runtimes.get(key);
  if (cached) return cached;

  const handle = ensToHandle(ens);
  const identity = await loadIdentity(handle);
  void markBooted(handle).catch(() => {});

  // Each TEE/non-TEE variant gets its own LocalBus pubkey so messages don't
  // mix. We append `:tee` to the actual axlPubkey hex for the bus key only —
  // the on-wire identity (signature, ENS record) still uses the canonical
  // pubkey because callers send to that.
  //
  // Catch: LocalBus dispatches by axlPubkey. Two runtimes for the same
  // identity would race. So instead of two buses, share one bus and
  // re-route on a per-call basis by booting only the requested variant
  // and tearing the other one down. Simpler approach: only one variant
  // boots at a time per ENS; if mode flips we restart.
  const existingNonTee = runtimes.get(ens);
  const existingTee = runtimes.get(`${ens}:tee`);
  if (useTee && existingNonTee) {
    existingNonTee.agent.stop?.();
    runtimes.delete(ens);
  }
  if (!useTee && existingTee) {
    existingTee.agent.stop?.();
    runtimes.delete(`${ens}:tee`);
  }

  const bus = new LocalBusClient(identity.axlPubkeyHex);
  const compute = await buildCompute(useTee);
  const storage = getStorage();
  const rep = new RepChain(storage);
  const skills = new SkillRegistry().add(SUMMARIZE).add(SENTIMENT);

  // Load owner-published prompt skills from Mongo and register them.
  // Failure here is non-fatal — we'd rather serve built-ins than 500
  // the whole agent when one custom skill row is malformed.
  try {
    const customs = await listPromptSkills(handle);
    for (const c of customs) {
      try {
        skills.add(
          makePromptSkill({
            id: c.skillId,
            name: c.name,
            description: c.description,
            tags: c.tags,
            systemPrompt: c.prompt,
            maxTokens: c.maxTokens,
            pricing: c.pricing ?? undefined,
          }),
        );
      } catch (e) {
        console.error(`[bootCallee] custom skill ${c.skillId} failed to register`, e);
      }
    }
  } catch (e) {
    console.error("[bootCallee] listPromptSkills failed", e);
  }

  const agent = new Agent({
    identity,
    axl: bus as any,
    compute: compute as any,
    storage,
    rep,
    skills,
  });
  void agent.start();

  const rt: CalleeRuntime = {
    handle,
    ens,
    agent,
    bus,
    identity,
    rep,
    compute,
    tee: useTee,
  };
  runtimes.set(key, rt);
  return rt;
}

// Stops both TEE and non-TEE variants for an ENS so the next /api/call
// re-boots with fresh skill registry. Called after /api/skills mutates
// prompt_skills.
export function evictRuntime(ens: string): void {
  for (const key of [ens, `${ens}:tee`]) {
    const rt = runtimes.get(key);
    if (rt) {
      rt.agent.stop?.();
      runtimes.delete(key);
    }
  }
}

async function makeCaller() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const pubHex = Buffer.from(pub).toString("hex");
  const bus = new LocalBusClient(pubHex);
  return { pubHex, bus };
}

export interface TraceEvent {
  step: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
}

export interface CallResult {
  ok: boolean;
  ens: string;
  skill: string;
  output?: unknown;
  error?: string;
  trace: TraceEvent[];
  responseSig?: string;
  responder?: string;
  totalMs: number;
  repHead?: string | null;
  // TEE attestation, present when caller asked for TEE mode and the
  // DirectCompute response carried a verifiable provider signature.
  teeAttestation?: { provider: string; verified: boolean } | null;
}

export type CallMode = { tee?: boolean; pay?: boolean };

export async function callAgentSkill(opts: {
  ens: string;
  skill: string;
  input: unknown;
  mode?: CallMode;
}): Promise<CallResult> {
  const trace: TraceEvent[] = [];
  const t0 = Date.now();
  const tick = (step: string, ok: boolean, detail?: unknown) =>
    trace.push({ step, ok, ms: Date.now() - t0, detail });

  const useTee = !!opts.mode?.tee;

  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(opts.ens);
    const cardJson = bundle["org.a2a.agent-card"];
    const axlPub = bundle["network.axl.pubkey"] ?? null;
    if (!cardJson || !axlPub) {
      tick("resolve-ens", false, "missing records");
      return finish(false, opts, trace, t0, "Agent not published");
    }
    const card = parseAgentCard(cardJson);
    tick("resolve-ens", true, {
      axlPubkey: axlPub,
      iNFT: bundle["org.erc7857.tokenId"] ?? null,
      skills: card.skills.map((s) => s.id),
    });

    const verifyError = await resolver.verifyIdentity(opts.ens, axlPub);
    const isHardFail = verifyError !== null && /mismatch/i.test(verifyError);
    if (isHardFail) {
      tick("verify-identity", false, verifyError);
      return finish(false, opts, trace, t0, "Identity verification failed");
    }
    tick("verify-identity", true, verifyError ?? "axl pubkey matched record");

    const callee = await bootCallee(opts.ens, useTee);
    if (callee.identity.axlPubkeyHex.toLowerCase() !== axlPub.toLowerCase()) {
      tick("boot-callee", false, "server identity does not match ENS");
      return finish(false, opts, trace, t0, "Server identity mismatch");
    }
    tick("boot-callee", true, { handle: callee.handle, tee: useTee });

    const caller = await makeCaller();
    tick("build-request", true, {
      callerPubkey: caller.pubHex,
      skill: opts.skill,
    });

    const dispatchStart = Date.now();
    const res = await callSkill({
      axl: caller.bus as any,
      destPubkey: callee.identity.axlPubkeyHex,
      callerPubkey: caller.pubHex,
      skill: opts.skill,
      input: opts.input,
      expectedResponderPubkey: callee.identity.axlPubkeyHex,
      timeoutMs: 90_000,
    });
    tick("dispatch + sign", true, { latencyMs: Date.now() - dispatchStart });
    tick("compute-result", true, { source: useTee ? "0G DirectCompute (TEE)" : "0G Compute" });
    tick("verify-response-sig", true, { responder: res.responder });

    let teeAttestation: CallResult["teeAttestation"] = null;
    if (useTee && callee.compute instanceof DirectCompute) {
      const att = (callee.compute as DirectCompute).lastTeeAttestation;
      if (att) {
        teeAttestation = { provider: att.provider, verified: att.verified };
        tick("tee-attest", att.verified, {
          provider: att.provider,
          verified: att.verified,
        });
      } else {
        tick("tee-attest", false, "no attestation captured");
      }
    }

    const repBefore = callee.rep.head;
    const repDeadline = Date.now() + 5_000;
    while (Date.now() < repDeadline && callee.rep.head === repBefore) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const repHead = callee.rep.head ?? null;
    if (repHead && repHead !== repBefore) {
      tick("rep-attestation", true, { rootHash: repHead });
    } else {
      tick("rep-attestation", false, "still uploading (continues in background)");
    }

    return {
      ok: true,
      ens: opts.ens,
      skill: opts.skill,
      output: res.output,
      trace,
      responseSig: res.sig,
      responder: res.responder,
      totalMs: Date.now() - t0,
      repHead,
      teeAttestation,
    };
  } catch (err) {
    console.error("[call-server] failed", err);
    const msg = err instanceof Error ? err.message : "call failed";
    tick("error", false, msg);
    return finish(false, opts, trace, t0, msg);
  }
}

// ── Streaming variant ─────────────────────────────────────────────────
//
// Yields events: `{kind:"trace", trace}` per resolve/verify/boot step,
// `{kind:"chunk", seq, text}` per signed chunk delta, and a terminal
// `{kind:"final", result: CallResult}` once the responder's skill.res
// arrives. /api/call route adapts these to SSE frames.

export type StreamEventOut =
  | { kind: "trace"; event: TraceEvent }
  | { kind: "chunk"; seq: number; text: string }
  | { kind: "final"; result: CallResult };

export async function* callAgentSkillStream(opts: {
  ens: string;
  skill: string;
  input: unknown;
  mode?: CallMode;
}): AsyncGenerator<StreamEventOut> {
  const trace: TraceEvent[] = [];
  const t0 = Date.now();
  const tick = (step: string, ok: boolean, detail?: unknown) => {
    const ev = { step, ok, ms: Date.now() - t0, detail };
    trace.push(ev);
    return ev;
  };

  const useTee = !!opts.mode?.tee;

  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(opts.ens);
    const cardJson = bundle["org.a2a.agent-card"];
    const axlPub = bundle["network.axl.pubkey"] ?? null;
    if (!cardJson || !axlPub) {
      yield { kind: "trace", event: tick("resolve-ens", false, "missing records") };
      yield { kind: "final", result: finish(false, opts, trace, t0, "Agent not published") };
      return;
    }
    const card = parseAgentCard(cardJson);
    yield {
      kind: "trace",
      event: tick("resolve-ens", true, {
        axlPubkey: axlPub,
        iNFT: bundle["org.erc7857.tokenId"] ?? null,
        skills: card.skills.map((s) => s.id),
      }),
    };

    const verifyError = await resolver.verifyIdentity(opts.ens, axlPub);
    const isHardFail = verifyError !== null && /mismatch/i.test(verifyError);
    if (isHardFail) {
      yield { kind: "trace", event: tick("verify-identity", false, verifyError) };
      yield {
        kind: "final",
        result: finish(false, opts, trace, t0, "Identity verification failed"),
      };
      return;
    }
    yield {
      kind: "trace",
      event: tick("verify-identity", true, verifyError ?? "axl pubkey matched record"),
    };

    const callee = await bootCallee(opts.ens, useTee);
    if (callee.identity.axlPubkeyHex.toLowerCase() !== axlPub.toLowerCase()) {
      yield { kind: "trace", event: tick("boot-callee", false, "server identity mismatch") };
      yield {
        kind: "final",
        result: finish(false, opts, trace, t0, "Server identity mismatch"),
      };
      return;
    }
    yield {
      kind: "trace",
      event: tick("boot-callee", true, { handle: callee.handle, tee: useTee }),
    };

    const caller = await makeCaller();
    yield {
      kind: "trace",
      event: tick("build-request", true, {
        callerPubkey: caller.pubHex,
        skill: opts.skill,
      }),
    };

    const dispatchStart = Date.now();
    // Buffered chunk channel — agent runtime emits asynchronously while we
    // await callSkillStream's terminal response. We push to a queue and
    // drain it in the for-await below.
    const chunkBuffer: Array<{ seq: number; text: string }> = [];
    let resolveNext: ((v: void) => void) | null = null;
    const wake = () => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    };

    const callPromise = callSkillStream({
      axl: caller.bus as any,
      destPubkey: callee.identity.axlPubkeyHex,
      callerPubkey: caller.pubHex,
      skill: opts.skill,
      input: opts.input,
      expectedResponderPubkey: callee.identity.axlPubkeyHex,
      timeoutMs: 90_000,
      onChunk: (seq, text) => {
        chunkBuffer.push({ seq, text });
        wake();
      },
    });

    let done = false;
    let finalRes: Awaited<typeof callPromise> | null = null;
    let finalErr: unknown = null;

    callPromise.then(
      (r) => {
        finalRes = r;
        done = true;
        wake();
      },
      (e) => {
        finalErr = e;
        done = true;
        wake();
      },
    );

    while (!done || chunkBuffer.length > 0) {
      while (chunkBuffer.length > 0) {
        const c = chunkBuffer.shift()!;
        yield { kind: "chunk", seq: c.seq, text: c.text };
      }
      if (done) break;
      await new Promise<void>((r) => {
        resolveNext = r;
      });
    }

    if (finalErr) throw finalErr;
    const res = finalRes!;
    yield {
      kind: "trace",
      event: tick("dispatch + sign", true, { latencyMs: Date.now() - dispatchStart }),
    };
    yield {
      kind: "trace",
      event: tick("compute-result", true, {
        source: useTee ? "0G DirectCompute (TEE)" : "0G Compute",
      }),
    };
    yield {
      kind: "trace",
      event: tick("verify-response-sig", true, { responder: res.responder }),
    };

    let teeAttestation: CallResult["teeAttestation"] = null;
    if (useTee && callee.compute instanceof DirectCompute) {
      const att = (callee.compute as DirectCompute).lastTeeAttestation;
      if (att) {
        teeAttestation = { provider: att.provider, verified: att.verified };
        yield {
          kind: "trace",
          event: tick("tee-attest", att.verified, {
            provider: att.provider,
            verified: att.verified,
          }),
        };
      }
    }

    const repBefore = callee.rep.head;
    const repDeadline = Date.now() + 5_000;
    while (Date.now() < repDeadline && callee.rep.head === repBefore) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const repHead = callee.rep.head ?? null;
    yield {
      kind: "trace",
      event:
        repHead && repHead !== repBefore
          ? tick("rep-attestation", true, { rootHash: repHead })
          : tick("rep-attestation", false, "still uploading (continues in background)"),
    };

    yield {
      kind: "final",
      result: {
        ok: true,
        ens: opts.ens,
        skill: opts.skill,
        output: res.output,
        trace,
        responseSig: res.sig,
        responder: res.responder,
        totalMs: Date.now() - t0,
        repHead,
        teeAttestation,
      },
    };
  } catch (err) {
    console.error("[call-server:stream] failed", err);
    const msg = err instanceof Error ? err.message : "call failed";
    yield { kind: "trace", event: tick("error", false, msg) };
    yield { kind: "final", result: finish(false, opts, trace, t0, msg) };
  }
}

function finish(
  ok: boolean,
  opts: { ens: string; skill: string },
  trace: TraceEvent[],
  t0: number,
  error: string,
): CallResult {
  return {
    ok,
    ens: opts.ens,
    skill: opts.skill,
    trace,
    totalMs: Date.now() - t0,
    error,
  };
}
