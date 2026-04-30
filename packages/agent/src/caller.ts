// Caller side: send a skill request to a remote agent, await the matching
// response, verify the responder's signature.
import { keccak256, toHex } from "viem";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalJson, type AxlClient } from "@agentdir/sdk";
import {
  isSkillResponse,
  type SkillRequest,
  type SkillResponseOk,
} from "./protocol.js";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export async function callSkill(args: {
  axl: AxlClient;
  destPubkey: string; // peer's AXL pubkey hex
  skill: string;
  input: unknown;
  callerINFT?: string;
  payment?: SkillRequest["payment"];
  /** Verify responder's sig matches this pubkey. Default = destPubkey. */
  expectedResponderPubkey?: string;
  timeoutMs?: number;
}): Promise<SkillResponseOk> {
  const id =
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  const req: SkillRequest = {
    v: 1,
    type: "skill.req",
    id,
    skill: args.skill,
    input: args.input,
    callerINFT: args.callerINFT,
    payment: args.payment,
  };
  await args.axl.sendJson(args.destPubkey, req);

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
      continue;
    }
    if (!isSkillResponse(parsed)) continue;
    if (parsed.id !== id) continue;
    if (!parsed.ok) throw new Error(`remote: ${parsed.error}`);
    // Verify signature.
    const expectedPub = args.expectedResponderPubkey ?? args.destPubkey;
    const digest = keccak256(toHex(canonicalJson({ id: parsed.id, output: parsed.output })));
    const sigOk = await ed.verifyAsync(
      Buffer.from(stripHex(parsed.sig), "hex"),
      Buffer.from(stripHex(digest), "hex"),
      Buffer.from(stripHex(expectedPub), "hex")
    );
    if (!sigOk) throw new Error("response signature invalid");
    return parsed;
  }
  throw new Error("call timeout");
}
