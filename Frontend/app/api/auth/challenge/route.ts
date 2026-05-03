import "server-only";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { issueChallenge } from "@/lib/wallet-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-errors";
import { isValidEns } from "@/lib/ens-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action: "mint";
  ownerAddress: string;
  ens: string;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`auth-challenge:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMIT" },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    const { body: e, status } = apiError("BAD_INPUT", "json", "challenge");
    return NextResponse.json(e, { status });
  }

  if (body.action !== "mint") {
    const { body: e, status } = apiError("BAD_INPUT", "action", "challenge");
    return NextResponse.json(e, { status });
  }
  if (!isAddress(body.ownerAddress)) {
    const { body: e, status } = apiError("BAD_INPUT", "ownerAddress", "challenge");
    return NextResponse.json(e, { status });
  }
  if (!isValidEns(body.ens)) {
    const { body: e, status } = apiError("ENS_INVALID", "ens", "challenge");
    return NextResponse.json(e, { status });
  }

  try {
    const ch = await issueChallenge({
      action: body.action,
      ownerAddress: body.ownerAddress,
      ens: body.ens,
    });
    return NextResponse.json(ch);
  } catch (e) {
    const { body, status } = apiError("INTERNAL", e, "challenge");
    return NextResponse.json(body, { status });
  }
}
