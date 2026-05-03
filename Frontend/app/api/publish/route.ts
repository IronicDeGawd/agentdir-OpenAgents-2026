import "server-only";
import { NextResponse } from "next/server";
import {
  createWalletClient,
  createPublicClient,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import { EnsWriter, buildAgentCard } from "@agentdir/sdk";
import { SUMMARIZE, SENTIMENT } from "@agentdir/agent";
import { AGENTDIR_INFT_ADDRESS } from "@/lib/galileo";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

const ENS_REGISTRY_SEPOLIA: Hex = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const PUBLIC_RESOLVER_SEPOLIA: Hex = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const PARENT_ENS = "agentdir.eth";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

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

  let txHashes: Hex[] = [];
  let recordKeys: string[];
  try {
    const account = privateKeyToAccount(ownerKey());
    const rpcUrl =
      process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
    const wallet = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const reader = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

    // Step 1 — register subnode in ENS Registry. Without this the subname
    // has no owner and no resolver record, so setText calls land in the
    // PublicResolver but reads return empty (Universal Resolver finds no
    // resolver for the subnode). setSubnodeRecord is idempotent — re-running
    // overwrites owner/resolver of an already-existing subnode, which is
    // fine for the server-managed agentdir.eth namespace.
    const parentNode = namehash(normalize(PARENT_ENS));
    const labelHash = keccak256(toBytes(handle));

    const subTx = await wallet.writeContract({
      address: ENS_REGISTRY_SEPOLIA,
      abi: REGISTRY_ABI,
      functionName: "setSubnodeRecord",
      args: [
        parentNode,
        labelHash,
        account.address,
        PUBLIC_RESOLVER_SEPOLIA,
        BigInt(0),
      ],
    });
    await reader.waitForTransactionReceipt({ hash: subTx, timeout: 60_000 });
    txHashes.push(subTx);

    // Step 2 — write the 5 text records via existing EnsWriter.
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
    const textTxs = await writer.publishBundle(ens, bundle);
    txHashes.push(...textTxs);
  } catch (e) {
    const { body, status } = apiError("PUBLISH_FAILED", e, "publish");
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ ens, txHashes, records: recordKeys });
}
