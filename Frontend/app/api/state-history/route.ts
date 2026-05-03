import "server-only";
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { galileo, AGENTDIR_INFT_ADDRESS } from "@/lib/galileo";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9]{1,20}$/;

const EVENT = parseAbiItem(
  "event AgentStateUpdated(uint256 indexed tokenId, bytes32 prevRoot, bytes32 newRoot, address indexed by)",
);

export async function GET(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`state-history:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit", code: "RATE_LIMIT" }, { status: 429 });
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!TOKEN_RE.test(token)) {
    const { body, status } = apiError("BAD_INPUT", "bad token", "state-history");
    return NextResponse.json(body, { status });
  }

  try {
    const client = createPublicClient({ chain: galileo, transport: http() });
    const logs = await client.getLogs({
      address: AGENTDIR_INFT_ADDRESS,
      event: EVENT,
      args: { tokenId: BigInt(token) },
      // Contract was deployed at block 30855328.
      fromBlock: BigInt(30_855_328),
      toBlock: "latest",
    });
    const events = logs.map((l) => ({
      tokenId: token,
      prevRoot: l.args.prevRoot,
      newRoot: l.args.newRoot,
      by: l.args.by,
      blockNumber: Number(l.blockNumber),
      txHash: l.transactionHash,
    }));
    return NextResponse.json({ tokenId: token, events });
  } catch (e) {
    const { body, status } = apiError("INTERNAL", e, "state-history");
    return NextResponse.json(body, { status });
  }
}
