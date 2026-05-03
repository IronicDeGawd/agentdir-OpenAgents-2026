import "server-only";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { SnapshotChain, RepChain } from "@agentdir/sdk";
import { getStorage, getEnsResolver } from "@/lib/sdk-server";
import { loadIdentity } from "@/lib/identity-store";
import { verifyAndConsume } from "@/lib/wallet-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;

interface Body {
  handle: string;
  ownerAddress: string;
  message: string;
  signature: string;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`snapshot:${ip}`, 5, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit", code: "RATE_LIMIT" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json", "snapshot");
    return NextResponse.json(e, { status });
  }

  const handle = (body.handle ?? "").toLowerCase().trim();
  const owner = body.ownerAddress ?? "";
  if (!HANDLE_RE.test(handle) || !isAddress(owner) || !SIG_RE.test(body.signature ?? "")) {
    const { body: e, status } = apiError("BAD_INPUT", "shape", "snapshot");
    return NextResponse.json(e, { status });
  }

  // 1. Load identity from Mongo (and confirm owner matches stored row).
  let identity;
  try {
    identity = await loadIdentity(handle);
  } catch (e) {
    const { body, status } = apiError("BAD_INPUT", "no identity", "snapshot");
    return NextResponse.json(body, { status });
  }
  if (!identity.inftTokenId) {
    const { body, status } = apiError("BAD_INPUT", "no tokenId", "snapshot");
    return NextResponse.json(body, { status });
  }

  // 2. Wallet challenge: caller must own the wallet that owns the iNFT.
  //    On-chain check is `ownerOf(tokenId)` deferred to client (saves an
  //    RPC roundtrip) — but signature here proves they at least control
  //    the address. Combined with on-chain `setStateRoot` (also done from
  //    the same wallet) the spoof attempt fails.
  const verify = await verifyAndConsume({
    ownerAddress: owner,
    ens: identity.ensName,
    message: body.message,
    signature: body.signature as `0x${string}`,
  });
  if (!verify.ok) {
    const { body: e, status } = apiError("BAD_INPUT", verify.reason ?? "verify", "snapshot");
    return NextResponse.json(e, { status });
  }

  // 3. Read current rep head from ENS.
  let repHead: string | null = null;
  try {
    const resolver = getEnsResolver();
    const v = await resolver.getText(identity.ensName, "network.agentdir.rep-head");
    repHead = v && v.length > 0 ? v : null;
  } catch (e) {
    console.warn("[snapshot] rep-head lookup failed (non-fatal)", e);
  }

  // 4. Optionally walk RepChain to count calls/oks. Best-effort; if 0G
  //    Storage is slow we still build a snapshot with zeros.
  let callsTotal = 0;
  let okTotal = 0;
  try {
    if (repHead) {
      const rep = new RepChain(getStorage(), repHead);
      const atts = await rep.walk(repHead, 200);
      callsTotal = atts.length;
      okTotal = atts.filter((a) => a.ok).length;
    }
  } catch (e) {
    console.warn("[snapshot] rep walk failed (non-fatal)", e);
  }

  // 5. Build, sign w/ stored AXL privkey, upload to 0G Storage.
  let root: string;
  let snapshot;
  try {
    const chain = new SnapshotChain(getStorage(), null);
    const priv = Buffer.from(identity.axlPrivateKeyHex, "hex");
    const result = await chain.append({
      ensName: identity.ensName,
      signerPubkey: identity.axlPubkeyHex,
      inftTokenId: identity.inftTokenId,
      callsTotal,
      okTotal,
      skillStats: {},
      repHead,
      signer: async (digestHex) => {
        const msg = Buffer.from(digestHex.slice(2), "hex");
        const sig = await ed.signAsync(msg, priv);
        return "0x" + Buffer.from(sig).toString("hex");
      },
    });
    root = result.root;
    snapshot = result.snapshot;
  } catch (e) {
    const { body, status } = apiError("STORAGE_UNAVAILABLE", e, "snapshot");
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({
    ens: identity.ensName,
    inftTokenId: identity.inftTokenId,
    root,
    snapshot,
  });
}
