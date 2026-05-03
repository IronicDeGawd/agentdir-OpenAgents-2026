import "server-only";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseGwei,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { galileo, AGENTDIR_INFT_ADDRESS, INFT_ABI } from "@/lib/galileo";
import { getEnsResolver } from "@/lib/sdk-server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const HEX_PUB_RE = /^[0-9a-f]{64}$/i;
const PARENT = "agentdir.eth";

interface MintBody {
  handle: string;
  axlPubkeyHex: string;
  ownerAddress: string;
}

function ownerKey(): Hex {
  const raw = process.env.PRIVATE_KEY ?? "";
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!HEX_KEY_RE.test(stripped)) {
    throw new Error("PRIVATE_KEY missing or malformed (server cannot mint)");
  }
  return `0x${stripped}` as Hex;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`mint:${ip}`, 3, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many mint requests", code: "RATE_LIMIT" },
      { status: 429 },
    );
  }

  let body: MintBody;
  try {
    body = (await req.json()) as MintBody;
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json parse", "mint");
    return NextResponse.json(e, { status });
  }

  const handle = (body.handle ?? "").toLowerCase().trim();
  const pub = (body.axlPubkeyHex ?? "").toLowerCase().replace(/^0x/, "");
  const owner = body.ownerAddress ?? "";

  if (!HANDLE_RE.test(handle)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad handle", "mint");
    return NextResponse.json(e, { status });
  }
  if (!HEX_PUB_RE.test(pub)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad axlPubkey", "mint");
    return NextResponse.json(e, { status });
  }
  if (!isAddress(owner)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad owner address", "mint");
    return NextResponse.json(e, { status });
  }

  const ens = `${handle}.${PARENT}`;

  // Re-check availability — race condition window between check and mint.
  try {
    const resolver = getEnsResolver();
    const existing = await resolver.getText(ens, "org.a2a.agent-card");
    if (existing) {
      const { body: e, status } = apiError("HANDLE_TAKEN", `taken: ${ens}`, "mint");
      return NextResponse.json(e, { status });
    }
  } catch (e) {
    const { body, status } = apiError("ENS_LOOKUP_FAILED", e, "mint");
    return NextResponse.json(body, { status });
  }

  // Send mint tx.
  let txHash: Hex;
  let tokenId: string;
  try {
    const account = privateKeyToAccount(ownerKey());
    const wallet = createWalletClient({
      account,
      chain: galileo,
      transport: http(),
    });
    const pubReader = createPublicClient({ chain: galileo, transport: http() });

    txHash = await wallet.writeContract({
      address: AGENTDIR_INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "mint",
      args: [
        owner as `0x${string}`,
        `0x${pub}` as `0x${string}`,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        `ens://${ens}`,
      ],
      gasPrice: parseGwei("5"),
    });

    const receipt = await pubReader.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });

    // Decode tokenId from Transfer(from=0x0, to=owner, tokenId=N) event.
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const log = receipt.logs.find(
      (l) =>
        l.topics[0] === transferTopic &&
        l.address.toLowerCase() === AGENTDIR_INFT_ADDRESS.toLowerCase(),
    );
    if (!log || !log.topics[3]) throw new Error("Transfer event missing");
    tokenId = BigInt(log.topics[3]).toString();
  } catch (e) {
    const { body, status } = apiError("MINT_FAILED", e, "mint");
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({
    tokenId,
    txHash,
    ens,
    explorer: `https://chainscan-galileo.0g.ai/tx/${txHash}`,
  });
}
