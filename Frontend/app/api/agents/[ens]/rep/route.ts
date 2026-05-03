import { NextResponse } from "next/server";
import { getEnsResolver, getRepChain } from "@/lib/sdk-server";
import { apiError } from "@/lib/api-errors";
import { clampNum, isValidEns } from "@/lib/ens-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Rep walks hit 0G storage which is slow + quota-sensitive. Cache 30s.
export const revalidate = 30;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ens: string }> }
) {
  const rl = rateLimit(`rep:${clientIp(req)}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }
  const { ens } = await ctx.params;
  if (!isValidEns(ens)) {
    const { body, status } = apiError(
      "ENS_INVALID",
      new Error(`bad ens: ${String(ens).slice(0, 64)}`),
      "rep",
    );
    return NextResponse.json(body, { status });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = clampNum(
    limitRaw === null || limitRaw === "" ? null : Number(limitRaw),
    1,
    200,
    50,
  );

  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(ens);
    const head = bundle["network.agentdir.rep-head"] ?? null;
    const axlPub = bundle["network.axl.pubkey"] ?? null;

    if (!head) {
      return NextResponse.json({ ens, head: null, count: 0, attestations: [] });
    }

    const chain = getRepChain();
    const attestations = await chain.walk(head, limit, axlPub ?? undefined);

    return NextResponse.json({
      ens,
      head,
      verifiedSignatures: !!axlPub,
      count: attestations.length,
      attestations,
    });
  } catch (err) {
    const { body, status } = apiError("REP_FAILED", err, "rep");
    return NextResponse.json(body, { status });
  }
}
