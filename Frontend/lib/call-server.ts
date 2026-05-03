import "server-only";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  Compute,
  RepChain,
  Storage,
  makeSigner,
} from "@agentdir/sdk";
import {
  Agent,
  LocalBusClient,
  callSkill,
  loadOrCreate,
  SkillRegistry,
  SUMMARIZE,
  SENTIMENT,
} from "@agentdir/agent";
import { getEnsResolver, getStorage } from "./sdk-server";
import { parseAgentCard } from "@agentdir/sdk/agent-card";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

// One persistent runtime per callee handle. LocalBus is process-global, so
// caller and callee share the same in-memory bus.
type CalleeRuntime = {
  handle: string;
  ens: string;
  agent: Agent;
  bus: LocalBusClient;
  identity: Awaited<ReturnType<typeof loadOrCreate>>;
  rep: RepChain;
};

const runtimes = new Map<string, CalleeRuntime>();

function ensToHandle(ens: string): string {
  // bob.agentdir.eth → bob
  const first = ens.split(".")[0];
  if (!first) throw new Error("invalid ens");
  return first;
}

async function bootCallee(ens: string): Promise<CalleeRuntime> {
  const cached = runtimes.get(ens);
  if (cached) return cached;

  const handle = ensToHandle(ens);
  const identity = await loadOrCreate(handle, null);
  const bus = new LocalBusClient(identity.axlPubkeyHex);

  if (!process.env.ZEROG_API_KEY) {
    throw new Error("ZEROG_API_KEY missing on server");
  }
  const compute = new Compute({
    apiKey: process.env.ZEROG_API_KEY,
    network: "testnet",
    model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
  });
  const storage = getStorage();
  const rep = new RepChain(storage);
  const skills = new SkillRegistry().add(SUMMARIZE).add(SENTIMENT);

  const agent = new Agent({
    identity,
    axl: bus as any,
    compute,
    storage,
    rep,
    skills,
  });
  // Fire and forget — Agent.start() returns promise that resolves on stop.
  void agent.start();

  const rt: CalleeRuntime = { handle, ens, agent, bus, identity, rep };
  runtimes.set(ens, rt);
  return rt;
}

// Per-call ephemeral caller identity — one keypair per request, no on-disk
// persistence. Caller doesn't need an iNFT for free demo calls.
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
}

export async function callAgentSkill(opts: {
  ens: string;
  skill: string;
  input: unknown;
}): Promise<CallResult> {
  const trace: TraceEvent[] = [];
  const t0 = Date.now();
  const tick = (step: string, ok: boolean, detail?: unknown) =>
    trace.push({ step, ok, ms: Date.now() - t0, detail });

  try {
    // 1. Resolve ENS + verify identity
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

    // verifyIdentity does forward+reverse address resolution + agent-card
    // pubkey cross-check. ENS subnames under agentdir.eth don't publish a
    // forward address record, so we surface the result but only block on
    // pubkey-mismatch failures (the actual identity binding).
    const verifyError = await resolver.verifyIdentity(opts.ens, axlPub);
    const isHardFail = verifyError !== null && /mismatch/i.test(verifyError);
    if (isHardFail) {
      tick("verify-identity", false, verifyError);
      return finish(false, opts, trace, t0, "Identity verification failed");
    }
    tick("verify-identity", true, verifyError ?? "axl pubkey matched record");

    // 2. Boot callee runtime (cached)
    const callee = await bootCallee(opts.ens);
    if (callee.identity.axlPubkeyHex.toLowerCase() !== axlPub.toLowerCase()) {
      tick("boot-callee", false, "server identity does not match ENS");
      return finish(false, opts, trace, t0, "Server identity mismatch");
    }
    tick("boot-callee", true, { handle: callee.handle });

    // 3. Caller identity
    const caller = await makeCaller();
    tick("build-request", true, {
      callerPubkey: caller.pubHex,
      skill: opts.skill,
    });

    // 4. callSkill — signs, dispatches, awaits + verifies response
    const dispatchStart = Date.now();
    const res = await callSkill({
      axl: caller.bus as any,
      destPubkey: callee.identity.axlPubkeyHex,
      callerPubkey: caller.pubHex,
      skill: opts.skill,
      input: opts.input,
      expectedResponderPubkey: callee.identity.axlPubkeyHex,
      timeoutMs: 60_000,
    });
    tick("dispatch + sign", true, { latencyMs: Date.now() - dispatchStart });
    tick("compute-result", true, { source: "0G Compute" });
    tick("verify-response-sig", true, { responder: res.responder });

    // 5. Wait briefly for rep attestation upload (fire-and-forget in agent
    // runtime, can take 30-60s on 0G; cap at 5s so UI stays snappy).
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
    };
  } catch (err) {
    console.error("[call-server] failed", err);
    const msg = err instanceof Error ? err.message : "call failed";
    tick("error", false, msg);
    return finish(false, opts, trace, t0, msg);
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
