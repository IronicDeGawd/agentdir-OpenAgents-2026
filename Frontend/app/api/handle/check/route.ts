import "server-only";
import { NextResponse } from "next/server";
import { getEnsResolver } from "@/lib/sdk-server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const PARENT = "agentdir.eth";

export async function GET(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`handle-check:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMIT" },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").toLowerCase().trim();
  if (!HANDLE_RE.test(handle)) {
    const { body, status } = apiError("BAD_INPUT", "invalid handle", "handle-check");
    return NextResponse.json(body, { status });
  }

  const ens = `${handle}.${PARENT}`;
  try {
    const resolver = getEnsResolver();
    const existing = await resolver.getText(ens, "org.a2a.agent-card");
    return NextResponse.json({ available: !existing, ens });
  } catch (e) {
    const { body, status } = apiError("ENS_LOOKUP_FAILED", e, "handle-check");
    return NextResponse.json(body, { status });
  }
}
