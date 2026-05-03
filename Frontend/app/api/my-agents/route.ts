import "server-only";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { findIdentityByOwner } from "@/lib/identity-store";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`my-agents:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit", code: "RATE_LIMIT" }, { status: 429 });
  }

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") ?? "";
  if (!isAddress(owner)) {
    const { body, status } = apiError("BAD_INPUT", "owner", "my-agents");
    return NextResponse.json(body, { status });
  }

  try {
    const rows = await findIdentityByOwner(owner);
    return NextResponse.json({ owner: owner.toLowerCase(), agents: rows });
  } catch (e) {
    const { body, status } = apiError("INTERNAL", e, "my-agents");
    return NextResponse.json(body, { status });
  }
}
