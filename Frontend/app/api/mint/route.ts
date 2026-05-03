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
import { verifyAndConsume } from "@/lib/wallet-auth";
import { saveIdentity, logMint } from "@/lib/identity-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const HEX_PUB_RE = /^[0-9a-f]{64}$/i;
const HEX_PRIV_RE = /^[0-9a-f]{64}$/i;
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
const PARENT = "agentdir.eth";

interface MintBody {
  handle: string;
  ownerAddress: string;
  // wallet challenge (replay-resistant proof user controls ownerAddress)
  message: string;
  signature: string;
  // identity, generated client-side, sealed server-side w/ KEK before storage
  identity: {
    axlPubkeyHex: string;
    axlPrivateKeyHex: string;
  };
}

function inftDeployerKey(): Hex {
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
  const owner = body.ownerAddress ?? "";
  const pub = (body.identity?.axlPubkeyHex ?? "").toLowerCase().replace(/^0x/, "");
  const priv = (body.identity?.axlPrivateKeyHex ?? "").toLowerCase().replace(/^0x/, "");
  const message = body.message ?? "";
  const signature = body.signature ?? "";

  if (!HANDLE_RE.test(handle)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad handle", "mint");
    return NextResponse.json(e, { status });
  }
  if (!isAddress(owner)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad owner address", "mint");
    return NextResponse.json(e, { status });
  }
  if (!HEX_PUB_RE.test(pub)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad axlPubkey", "mint");
    return NextResponse.json(e, { status });
  }
  if (!HEX_PRIV_RE.test(priv)) {
    const { body: e, status } = apiError("BAD_INPUT", "bad axlPrivkey", "mint");
    return NextResponse.json(e, { status });
  }
  if (!SIG_RE.test(signature) || message.length < 32 || message.length > 1024) {
    const { body: e, status } = apiError("BAD_INPUT", "bad signature", "mint");
    return NextResponse.json(e, { status });
  }

  const ens = `${handle}.${PARENT}`;

  // 1. Wallet signature challenge — proves caller controls ownerAddress
  //    AND has not seen this nonce before. Atomic consume in Mongo.
  const verify = await verifyAndConsume({
    ownerAddress: owner,
    ens,
    message,
    signature: signature as `0x${string}`,
  });
  if (!verify.ok) {
    const { body: e, status } = apiError("BAD_INPUT", verify.reason ?? "verify failed", "mint");
    return NextResponse.json(e, { status });
  }

  // 2. Re-check availability via ENS — defends against minting the same
  //    handle twice across server instances (Mongo unique index would
  //    also catch it but ENS check is faster and cheaper).
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

  // 3. Send mint tx on 0G Galileo (server signs as iNFT contract owner).
  let txHash: Hex;
  let tokenId: string;
  try {
    const account = privateKeyToAccount(inftDeployerKey());
    const wallet = createWalletClient({ account, chain: galileo, transport: http() });
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

  // 4. Persist identity (encrypted) BEFORE returning success. Failure here
  //    is a partial-completion edge case: token is minted but server
  //    can't host the runtime. Surface as 5xx so user retries — Mongo
  //    insert is idempotent via unique handle index, and the second
  //    attempt re-binds the SAME pubkey because it was already written
  //    to ENS during a follow-up publish.
  try {
    await saveIdentity({
      handle,
      ens,
      ownerAddress: owner,
      axlPrivateKeyHex: priv,
      axlPubkeyHex: pub,
      inftContract: AGENTDIR_INFT_ADDRESS,
      inftTokenId: tokenId,
    });
  } catch (e) {
    const { body, status } = apiError("INTERNAL", e, "mint:save-identity");
    return NextResponse.json(body, { status });
  }

  // 5. Audit log — fire-and-forget; failure here doesn't block success.
  void logMint({
    handle,
    ens,
    ownerAddress: owner,
    txHashGalileo: txHash,
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
  }).catch((e) => console.error("[mint] audit log failed", e));

  return NextResponse.json({
    tokenId,
    txHash,
    ens,
    explorer: `https://chainscan-galileo.0g.ai/tx/${txHash}`,
  });
}
