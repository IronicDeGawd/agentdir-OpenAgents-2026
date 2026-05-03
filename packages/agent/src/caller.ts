// Caller side: send a skill request to a remote agent, await the matching
// response, verify the responder's signature.
//
// IMPORTANT: callSkill consumes from the SAME AXL recv queue the local
// agent reads. To keep co-located callers from stealing inbound messages,
// it accepts a `reinject` callback to push non-matching messages back to
// the agent. If you can run the caller on a separate AXL node, do that —
// it is the cleanest fix.

import { keccak256, toHex } from "viem";
import { randomUUID, randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalJson, type AxlClient } from "@agentdir/sdk";
import {
  isSkillRequest,
  isSkillResponse,
  isSkillChunk,
  type ResponseSigDomain,
  type ChunkSigDomain,
  type SkillRequest,
  type SkillChunk,
  type SkillResponseOk,
} from "./protocol.js";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export type CallSkillArgs = {
  axl: AxlClient;
  destPubkey: string; // peer's AXL pubkey hex (no 0x)
  callerPubkey: string; // our local AXL pubkey hex (no 0x); bound into sig domain
  skill: string;
  input: unknown;
  callerINFT?: string;
  payment?: SkillRequest["payment"];
  /** Verify responder's sig matches this pubkey. Default = destPubkey. */
  expectedResponderPubkey?: string;
  timeoutMs?: number;
  /** Max acceptable clock skew on responder's `ts`. Default 30 s. */
  maxResponseAgeMs?: number;
  /**
   * Optional callback fired for every non-response message we see while
   * polling. Use it to forward inbound skill.req messages to your local
   * Agent's handleInbound so co-located callers don't drop them.
   */
  onForeignMessage?: (m: { from: string; body: string }) => Promise<void> | void;
};

export type StreamEvent =
  | { kind: "chunk"; seq: number; text: string }
  | { kind: "final"; response: SkillResponseOk };

export type CallSkillStreamArgs = CallSkillArgs & {
  onChunk: (seq: number, text: string) => void | Promise<void>;
};

/**
 * Streaming variant. Sends a `stream:true` request, accumulates signed
 * chunks via the responder's stream handler, then awaits the terminal
 * skill.res. Each chunk's signature is verified independently against
 * the expected responder pubkey — a man-in-the-middle can't drop,
 * reorder, or fabricate chunks. Out-of-order seqs throw.
 */
export async function callSkillStream(args: CallSkillStreamArgs): Promise<SkillResponseOk> {
  const id = randomUUID();
  const nonce = randomBytes(16).toString("hex");
  const req: SkillRequest = {
    v: 1,
    type: "skill.req",
    id,
    nonce,
    ts: Date.now(),
    skill: args.skill,
    input: args.input,
    callerINFT: args.callerINFT,
    callerPubkey: args.callerPubkey,
    payment: args.payment,
    stream: true,
  };
  await args.axl.sendJson(args.destPubkey, req);

  const expectedPub = (args.expectedResponderPubkey ?? args.destPubkey).toLowerCase();
  const maxAge = args.maxResponseAgeMs ?? 30_000;
  const deadline = Date.now() + (args.timeoutMs ?? 90_000);
  let nextSeq = 0;

  while (Date.now() < deadline) {
    const m = await args.axl.recvOnce();
    if (!m) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.body);
    } catch {
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    if (isSkillChunk(parsed)) {
      const c = parsed as SkillChunk;
      if (c.id !== id) continue;
      if (c.signerPubkey.toLowerCase() !== expectedPub)
        throw new Error(`chunk signer mismatch: ${c.signerPubkey}`);
      if (c.responder.toLowerCase() !== expectedPub)
        throw new Error("chunk responder mismatch");
      if (c.caller.toLowerCase() !== args.callerPubkey.toLowerCase())
        throw new Error("chunk not addressed to this caller");
      if (c.skill !== args.skill) throw new Error("chunk skill mismatch");
      if (c.seq !== nextSeq) throw new Error(`chunk seq out of order: got ${c.seq} expected ${nextSeq}`);
      const skew = Math.abs(Date.now() - c.ts);
      if (skew > maxAge) throw new Error(`stale chunk: ${skew}ms`);
      const domain: ChunkSigDomain = {
        v: 1,
        id: c.id,
        seq: c.seq,
        text: c.text,
        responder: c.responder,
        caller: c.caller,
        skill: c.skill,
        ts: c.ts,
      };
      const digest = keccak256(toHex(canonicalJson(domain)));
      const sigOk = await ed.verifyAsync(
        Buffer.from(stripHex(c.sig), "hex"),
        Buffer.from(stripHex(digest), "hex"),
        Buffer.from(stripHex(expectedPub), "hex"),
      );
      if (!sigOk) throw new Error(`chunk ${c.seq} signature invalid`);
      await args.onChunk(c.seq, c.text);
      nextSeq += 1;
      continue;
    }
    if (isSkillRequest(parsed)) {
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    if (!isSkillResponse(parsed)) {
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    if (parsed.id !== id) continue;
    // Same final-response verification as non-streaming callSkill.
    if (parsed.signerPubkey.toLowerCase() !== expectedPub)
      throw new Error(`responder pubkey mismatch: got ${parsed.signerPubkey}`);
    if (parsed.responder.toLowerCase() !== expectedPub)
      throw new Error("responder field mismatch");
    if (parsed.caller.toLowerCase() !== args.callerPubkey.toLowerCase())
      throw new Error("response not addressed to this caller");
    if (parsed.skill !== args.skill) throw new Error("skill mismatch in response");
    const skew = Math.abs(Date.now() - parsed.ts);
    if (skew > maxAge) throw new Error(`stale response: ${skew}ms`);
    const domain: ResponseSigDomain = parsed.ok
      ? {
          v: 1,
          id: parsed.id,
          ok: true,
          output: parsed.output,
          responder: parsed.responder,
          caller: parsed.caller,
          skill: parsed.skill,
          ts: parsed.ts,
        }
      : {
          v: 1,
          id: parsed.id,
          ok: false,
          error: parsed.error,
          responder: parsed.responder,
          caller: parsed.caller,
          skill: parsed.skill,
          ts: parsed.ts,
        };
    const digest = keccak256(toHex(canonicalJson(domain)));
    const sigOk = await ed.verifyAsync(
      Buffer.from(stripHex(parsed.sig), "hex"),
      Buffer.from(stripHex(digest), "hex"),
      Buffer.from(stripHex(expectedPub), "hex"),
    );
    if (!sigOk) throw new Error("response signature invalid");
    if (!parsed.ok) throw new Error(`remote: ${parsed.error}`);
    return parsed;
  }
  throw new Error("call timeout");
}

export async function callSkill(args: CallSkillArgs): Promise<SkillResponseOk> {
  const id = randomUUID();
  const nonce = randomBytes(16).toString("hex");
  const req: SkillRequest = {
    v: 1,
    type: "skill.req",
    id,
    nonce,
    ts: Date.now(),
    skill: args.skill,
    input: args.input,
    callerINFT: args.callerINFT,
    callerPubkey: args.callerPubkey,
    payment: args.payment,
  };
  await args.axl.sendJson(args.destPubkey, req);

  const expectedPub = (args.expectedResponderPubkey ?? args.destPubkey).toLowerCase();
  const maxAge = args.maxResponseAgeMs ?? 30_000;
  const deadline = Date.now() + (args.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    const m = await args.axl.recvOnce();
    if (!m) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.body);
    } catch {
      // Non-JSON foreign traffic — surface to caller's hook.
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    // Forward unrelated skill.req traffic so co-located agent doesn't lose it.
    if (isSkillRequest(parsed)) {
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    if (!isSkillResponse(parsed)) {
      if (args.onForeignMessage) await args.onForeignMessage(m);
      continue;
    }
    if (parsed.id !== id) {
      // Not for us — but it's still a response to *some* call, so dropping is fine.
      continue;
    }
    // Identity binding — reject if any of the bound fields disagree.
    if (parsed.signerPubkey.toLowerCase() !== expectedPub)
      throw new Error(`responder pubkey mismatch: got ${parsed.signerPubkey}`);
    if (parsed.responder.toLowerCase() !== expectedPub)
      throw new Error("responder field mismatch");
    if (parsed.caller.toLowerCase() !== args.callerPubkey.toLowerCase())
      throw new Error("response not addressed to this caller");
    if (parsed.skill !== args.skill) throw new Error("skill mismatch in response");
    const skew = Math.abs(Date.now() - parsed.ts);
    if (skew > maxAge) throw new Error(`stale response: ${skew}ms`);

    const domain: ResponseSigDomain = parsed.ok
      ? {
          v: 1,
          id: parsed.id,
          ok: true,
          output: parsed.output,
          responder: parsed.responder,
          caller: parsed.caller,
          skill: parsed.skill,
          ts: parsed.ts,
        }
      : {
          v: 1,
          id: parsed.id,
          ok: false,
          error: parsed.error,
          responder: parsed.responder,
          caller: parsed.caller,
          skill: parsed.skill,
          ts: parsed.ts,
        };
    const digest = keccak256(toHex(canonicalJson(domain)));
    const sigOk = await ed.verifyAsync(
      Buffer.from(stripHex(parsed.sig), "hex"),
      Buffer.from(stripHex(digest), "hex"),
      Buffer.from(stripHex(expectedPub), "hex")
    );
    if (!sigOk) throw new Error("response signature invalid");
    if (!parsed.ok) throw new Error(`remote: ${parsed.error}`);
    return parsed;
  }
  throw new Error("call timeout");
}
