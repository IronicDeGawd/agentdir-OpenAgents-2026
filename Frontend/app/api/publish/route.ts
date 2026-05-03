import "server-only";
import { NextResponse } from "next/server";
import { isAddress, type Hex } from "viem";
import { EnsWriter, buildAgentCard } from "@agentdir/sdk";
import { SUMMARIZE, SENTIMENT } from "@agentdir/agent";
import { AGENTDIR_INFT_ADDRESS } from "@/lib/galileo";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const HEX_PUB_RE = /^[0-9a-f]{64}$/i;
const TOKEN_ID_RE = /^[0-9]{1,20}$/;
const PARENT = "agentdir.eth";

interface PublishBody {
  handle: string;
  axlPubkeyHex: string;
  ownerAddress: string;
  tokenId: string;
}

function ownerKey(): Hex {
  const raw = process.env.PRIVATE_KEY ?? "";
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!HEX_KEY_RE.test(stripped)) {
    throw new Error("PRIVATE_KEY missing — server cannot publish ENS records");
  }
  return `0x${stripped}` as Hex;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`publish:${ip}`, 5, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many publish requests", code: "RATE_LIMIT" },
      { status: 429 },
    );
  }

  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json parse", "publish");
    return NextResponse.json(e, { status });
  }

  const handle = (body.handle ?? "").toLowerCase().trim();
  const pub = (body.axlPubkeyHex ?? "").toLowerCase().replace(/^0x/, "");
  const owner = body.ownerAddress ?? "";
  const tokenId = body.tokenId ?? "";

  if (!HANDLE_RE.test(handle)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad handle", "publish");
    return NextResponse.json(e, { status });
  }
  if (!HEX_PUB_RE.test(pub)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad pubkey", "publish");
    return NextResponse.json(e, { status });
  }
  if (!isAddress(owner)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad owner", "publish");
    return NextResponse.json(e, { status });
  }
  if (!TOKEN_ID_RE.test(tokenId)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad tokenId", "publish");
    return NextResponse.json(e, { status });
  }

  const ens = `${handle}.${PARENT}`;

  let txHashes: string[];
  let recordKeys: string[];
  try {
    const card = buildAgentCard({
      name: ens,
      description: `agentdir agent ${handle}`,
      axlPubkey: pub,
      skills: [SUMMARIZE.def, SENTIMENT.def],
      erc7857: {
        chainId: 16602,
        contract: AGENTDIR_INFT_ADDRESS,
        tokenId,
      },
    });

    const writer = new EnsWriter({
      privateKey: ownerKey(),
      rpcUrl: process.env.SEPOLIA_RPC_URL,
    });
    const bundle = EnsWriter.bundleFromCard(card, {});

    recordKeys = Object.keys(bundle);
    txHashes = await writer.publishBundle(ens, bundle);
  } catch (e) {
    const { body, status } = apiError("PUBLISH_FAILED", e, "publish");
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ ens, txHashes, records: recordKeys });
}
