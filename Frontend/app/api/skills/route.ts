import "server-only";
import { NextResponse } from "next/server";
import { isAddress, type Hex } from "viem";
import { EnsWriter, buildAgentCard } from "@agentdir/sdk";
import { SUMMARIZE, SENTIMENT } from "@agentdir/agent";
import {
  listPromptSkills,
  upsertPromptSkill,
  deletePromptSkill,
  countActiveSkills,
} from "@/lib/prompt-skills";
import { loadIdentity } from "@/lib/identity-store";
import { evictRuntime } from "@/lib/call-server";
import { verifyAndConsume } from "@/lib/wallet-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";
import { AGENTDIR_INFT_ADDRESS } from "@/lib/galileo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const SKILL_ID_RE = /^[a-z0-9_-]{1,32}$/;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
const RESERVED = new Set(["summarize", "sentiment", "route"]);
const MAX_PROMPT_LEN = 4_000;
const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 280;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
const MAX_TOKENS_HARD = 1_024;
const MAX_PER_HANDLE = 16;

function ownerKey(): Hex {
  const raw = process.env.PRIVATE_KEY ?? "";
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!HEX_KEY_RE.test(stripped)) throw new Error("PRIVATE_KEY missing");
  return `0x${stripped}` as Hex;
}

interface SkillBody {
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompt: string;
  maxTokens: number;
  pricing?: { x402: { token: string; chainId: number; amount: string } } | null;
}

interface PostBody {
  handle: string;
  ownerAddress: string;
  message: string;
  signature: string;
  skill: SkillBody;
}

function validSkill(s: any): string | null {
  if (!s || typeof s !== "object") return "skill missing";
  if (typeof s.id !== "string" || !SKILL_ID_RE.test(s.id)) return "bad id";
  if (RESERVED.has(s.id)) return `id '${s.id}' is reserved`;
  if (typeof s.name !== "string" || !s.name.length || s.name.length > MAX_NAME_LEN) return "bad name";
  if (typeof s.description !== "string" || s.description.length > MAX_DESC_LEN) return "bad description";
  if (!Array.isArray(s.tags)) return "tags must be array";
  if (s.tags.length > MAX_TAGS) return `too many tags (max ${MAX_TAGS})`;
  for (const t of s.tags) {
    if (typeof t !== "string" || !t.length || t.length > MAX_TAG_LEN) return "bad tag";
  }
  if (typeof s.prompt !== "string" || !s.prompt.length || s.prompt.length > MAX_PROMPT_LEN) {
    return `prompt 1..${MAX_PROMPT_LEN} chars required`;
  }
  if (!Number.isInteger(s.maxTokens) || s.maxTokens < 1 || s.maxTokens > MAX_TOKENS_HARD) {
    return `maxTokens 1..${MAX_TOKENS_HARD}`;
  }
  if (s.pricing != null) {
    const p = s.pricing?.x402;
    if (!p || typeof p.token !== "string" || typeof p.chainId !== "number" || typeof p.amount !== "string") {
      return "bad pricing";
    }
  }
  return null;
}

async function republishCard(
  handle: string,
  ens: string,
  axlPubkey: string,
  inftTokenId: string | undefined,
): Promise<{ txHashes: string[] }> {
  // Build the full skill list = baseline (summarize, sentiment) + active
  // prompt_skills for this handle. Republish ONLY org.a2a.agent-card via
  // a single setText so we don't redo the 4-record setSubnodeRecord dance.
  const customs = await listPromptSkills(handle);
  const customDefs = customs.map((c) => ({
    id: c.skillId,
    name: c.name,
    description: c.description,
    tags: c.tags,
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", maxLength: 5000 } },
    },
    outputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
    },
    ...(c.pricing ? { pricing: c.pricing } : {}),
  }));

  const card = buildAgentCard({
    name: ens,
    description: `agentdir agent ${handle}`,
    axlPubkey,
    skills: [SUMMARIZE.def, SENTIMENT.def, ...customDefs],
    erc7857: inftTokenId
      ? { chainId: 16602, contract: AGENTDIR_INFT_ADDRESS, tokenId: inftTokenId }
      : undefined,
  });

  const writer = new EnsWriter({
    privateKey: ownerKey(),
    rpcUrl: process.env.SEPOLIA_RPC_URL,
  });
  const txHash = await writer.setText(ens, "org.a2a.agent-card", JSON.stringify(card));
  return { txHashes: [txHash] };
}

async function ensureOwner(handle: string, ownerAddress: string): Promise<{ ens: string; pub: string; tokenId?: string } | string> {
  const id = await loadIdentity(handle);
  // Mongo identity row's ownerAddress was lowercased on save.
  const stored = await (await import("@/lib/identity-store")).findIdentityByOwner(ownerAddress);
  const isOwner = stored.some((r) => r.handle === handle);
  if (!isOwner) return "not owner";
  return { ens: id.ensName, pub: id.axlPubkeyHex, tokenId: id.inftTokenId };
}

// ── POST: add or update a skill ──────────────────────────────────────

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`skills:${ip}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit", code: "RATE_LIMIT" }, { status: 429 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json", "skills");
    return NextResponse.json(e, { status });
  }

  const handle = (body.handle ?? "").toLowerCase().trim();
  const owner = body.ownerAddress ?? "";
  const sig = body.signature ?? "";
  const msg = body.message ?? "";
  if (!HANDLE_RE.test(handle) || !isAddress(owner) || !SIG_RE.test(sig) || !msg) {
    const { body: e, status } = apiError("BAD_INPUT", "shape", "skills");
    return NextResponse.json(e, { status });
  }
  const valErr = validSkill(body.skill);
  if (valErr) {
    const { body: e, status } = apiError("BAD_INPUT", valErr, "skills");
    return NextResponse.json(e, { status });
  }

  // Ownership + nonce
  const ownerCheck = await ensureOwner(handle, owner);
  if (typeof ownerCheck === "string") {
    const { body: e, status } = apiError("BAD_INPUT", ownerCheck, "skills");
    return NextResponse.json(e, { status });
  }

  const verify = await verifyAndConsume({
    ownerAddress: owner,
    ens: ownerCheck.ens,
    message: msg,
    signature: sig as `0x${string}`,
  });
  if (!verify.ok) {
    const { body: e, status } = apiError("BAD_INPUT", verify.reason ?? "verify", "skills");
    return NextResponse.json(e, { status });
  }

  // Cap per-handle
  const existing = await countActiveSkills(handle);
  // If the same id exists already, this is an update, doesn't grow the count.
  const customs = await listPromptSkills(handle);
  const isUpdate = customs.some((c) => c.skillId === body.skill.id);
  if (!isUpdate && existing >= MAX_PER_HANDLE) {
    const { body: e, status } = apiError(
      "BAD_INPUT",
      `max ${MAX_PER_HANDLE} skills per handle`,
      "skills",
    );
    return NextResponse.json(e, { status });
  }

  try {
    await upsertPromptSkill({
      handle,
      ens: ownerCheck.ens,
      ownerAddress: owner,
      skillId: body.skill.id,
      name: body.skill.name,
      description: body.skill.description,
      tags: body.skill.tags,
      prompt: body.skill.prompt,
      maxTokens: body.skill.maxTokens,
      pricing: body.skill.pricing ?? null,
    });
  } catch (e) {
    const { body: er, status } = apiError("INTERNAL", e, "skills:upsert");
    return NextResponse.json(er, { status });
  }

  let publish: { txHashes: string[] };
  try {
    publish = await republishCard(handle, ownerCheck.ens, ownerCheck.pub, ownerCheck.tokenId);
  } catch (e) {
    const { body: er, status } = apiError("PUBLISH_FAILED", e, "skills:publish");
    return NextResponse.json(er, { status });
  }

  // Drop runtime cache so next /call re-boots with fresh skill registry.
  evictRuntime(ownerCheck.ens);

  return NextResponse.json({
    ok: true,
    skillId: body.skill.id,
    ens: ownerCheck.ens,
    txHashes: publish.txHashes,
  });
}

// ── DELETE: remove a skill ─────────────────────────────────────────────

export async function DELETE(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`skills:${ip}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit", code: "RATE_LIMIT" }, { status: 429 });
  }

  let body: { handle: string; id: string; ownerAddress: string; message: string; signature: string };
  try {
    body = await req.json();
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json", "skills:delete");
    return NextResponse.json(e, { status });
  }
  const handle = (body.handle ?? "").toLowerCase().trim();
  const id = (body.id ?? "").trim();
  const owner = body.ownerAddress ?? "";
  if (
    !HANDLE_RE.test(handle) ||
    !SKILL_ID_RE.test(id) ||
    !isAddress(owner) ||
    !SIG_RE.test(body.signature ?? "") ||
    !body.message
  ) {
    const { body: e, status } = apiError("BAD_INPUT", "shape", "skills:delete");
    return NextResponse.json(e, { status });
  }

  const ownerCheck = await ensureOwner(handle, owner);
  if (typeof ownerCheck === "string") {
    const { body: e, status } = apiError("BAD_INPUT", ownerCheck, "skills:delete");
    return NextResponse.json(e, { status });
  }
  const verify = await verifyAndConsume({
    ownerAddress: owner,
    ens: ownerCheck.ens,
    message: body.message,
    signature: body.signature as `0x${string}`,
  });
  if (!verify.ok) {
    const { body: e, status } = apiError("BAD_INPUT", verify.reason ?? "verify", "skills:delete");
    return NextResponse.json(e, { status });
  }

  const wasDeleted = await deletePromptSkill(handle, id);
  if (!wasDeleted) {
    const { body: e, status } = apiError("BAD_INPUT", "skill not found", "skills:delete");
    return NextResponse.json(e, { status });
  }

  let publish: { txHashes: string[] };
  try {
    publish = await republishCard(handle, ownerCheck.ens, ownerCheck.pub, ownerCheck.tokenId);
  } catch (e) {
    const { body: er, status } = apiError("PUBLISH_FAILED", e, "skills:delete:publish");
    return NextResponse.json(er, { status });
  }
  evictRuntime(ownerCheck.ens);

  return NextResponse.json({ ok: true, skillId: id, txHashes: publish.txHashes });
}

// ── GET: list active prompt skills for a handle ────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").toLowerCase().trim();
  if (!HANDLE_RE.test(handle)) {
    const { body, status } = apiError("BAD_INPUT", "handle", "skills:get");
    return NextResponse.json(body, { status });
  }
  const rows = await listPromptSkills(handle);
  return NextResponse.json({
    handle,
    skills: rows.map((r) => ({
      id: r.skillId,
      name: r.name,
      description: r.description,
      tags: r.tags,
      prompt: r.prompt,
      maxTokens: r.maxTokens,
      pricing: r.pricing,
      updatedAt: r.updatedAt,
    })),
  });
}
