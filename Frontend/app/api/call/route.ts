import { NextResponse } from "next/server";
import { callAgentSkill, callAgentSkillStream } from "@/lib/call-server";
import { apiError } from "@/lib/api-errors";
import { isValidEns } from "@/lib/ens-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_INPUT_BYTES = 16 * 1024;
const SKILL_RE = /^[a-z0-9_-]{1,64}$/;

export async function POST(req: Request) {
  // Tighter limit than read endpoints — call hits 0G Compute (paid).
  const rl = rateLimit(`call:${clientIp(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const { body: errBody, status } = apiError("BAD_INPUT", new Error("invalid json"), "call");
    return NextResponse.json(errBody, { status });
  }

  if (!body || typeof body !== "object") {
    const { body: errBody, status } = apiError("BAD_INPUT", new Error("body not object"), "call");
    return NextResponse.json(errBody, { status });
  }
  const { ens, skill, input, mode, stream } = body as {
    ens?: unknown;
    skill?: unknown;
    input?: unknown;
    mode?: { tee?: boolean; pay?: boolean };
    stream?: boolean;
  };

  if (typeof ens !== "string" || !isValidEns(ens)) {
    const { body: errBody, status } = apiError("ENS_INVALID", new Error(`bad ens: ${String(ens).slice(0, 64)}`), "call");
    return NextResponse.json(errBody, { status });
  }
  if (typeof skill !== "string" || !SKILL_RE.test(skill)) {
    const { body: errBody, status } = apiError("BAD_INPUT", new Error(`bad skill: ${String(skill).slice(0, 64)}`), "call");
    return NextResponse.json(errBody, { status });
  }
  if (input === undefined) {
    const { body: errBody, status } = apiError("BAD_INPUT", new Error("missing input"), "call");
    return NextResponse.json(errBody, { status });
  }
  if (JSON.stringify(input).length > MAX_INPUT_BYTES) {
    const { body: errBody, status } = apiError("BAD_INPUT", new Error("input too large"), "call");
    return NextResponse.json(errBody, { status });
  }

  const safeMode = {
    tee: !!mode?.tee,
    pay: !!mode?.pay,
  };

  if (!stream) {
    const result = await callAgentSkill({ ens, skill, input, mode: safeMode });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  // SSE — stream trace + signed chunks + final result.
  const encoder = new TextEncoder();
  const body_ = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        for await (const ev of callAgentSkillStream({
          ens,
          skill,
          input,
          mode: safeMode,
        })) {
          if (ev.kind === "trace") send("trace", ev.event);
          else if (ev.kind === "chunk") send("chunk", { seq: ev.seq, text: ev.text });
          else if (ev.kind === "final") send("final", ev.result);
        }
      } catch (e) {
        send("error", { error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body_, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
