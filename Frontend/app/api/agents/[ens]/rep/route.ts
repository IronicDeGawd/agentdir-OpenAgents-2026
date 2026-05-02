import { NextResponse } from "next/server";
import { getEnsResolver, getRepChain } from "@/lib/sdk-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ens: string }> }
) {
  const { ens } = await ctx.params;
  const url = new URL(req.url);
  const limit = clampNum(url.searchParams.get("limit"), 50, 1, 200);

  if (!ens) {
    return NextResponse.json({ error: "missing ens param" }, { status: 400 });
  }

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
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "rep walk failed" },
      { status: 500 }
    );
  }
}

function clampNum(
  v: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
