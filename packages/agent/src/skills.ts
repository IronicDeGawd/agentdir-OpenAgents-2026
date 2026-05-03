// Skill registry. Each skill = {def, handler}. Pluggable per agent.
import type { Compute, DirectCompute, AxlClient, RoutingTable } from "@agentdir/sdk";
import type { Skill, RouteSkillInput, RouteSkillOutput, RouteHop } from "@agentdir/sdk";
import { callSkill } from "./caller.js";

/** Compute that skill handlers see. Either Router (Compute) or
 *  TEE-direct (DirectCompute). Both expose `chat({...})` and
 *  `lastTeeAttestation` so the agent runtime can read attestation
 *  metadata without an instanceof check. */
export type SkillCtx = {
  compute: Compute | DirectCompute;
  /** Present only when the agent runtime is configured for swarm
   *  routing (AgentOpts.swarm). The `route` skill uses these. */
  swarm?: {
    axl: AxlClient;
    /** Caller AXL pubkey hex used as `callerPubkey` on outbound hops. */
    callerPubkey: string;
    /** Hex caller signer for outbound hops (re-uses identity sign). */
    callerINFT?: string;
    routingTable: RoutingTable;
  };
};
export type SkillHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: SkillCtx
) => Promise<O>;

/** Streaming variant. Yields text chunks as they arrive from the model,
 *  returns the final structured output as the generator's return value.
 *  Agent runtime emits each yielded chunk as a signed `skill.chunk` over
 *  AXL, then signs the return value as the terminal `skill.res`. */
export type SkillStreamHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: SkillCtx
) => AsyncGenerator<string, O, void>;

export type RegisteredSkill = {
  def: Skill;
  handler: SkillHandler;
  /** When present, agent runtime prefers the stream handler if the
   *  caller requested streaming (skill.req.stream=true). */
  streamHandler?: SkillStreamHandler;
};

export class SkillRegistry {
  private map = new Map<string, RegisteredSkill>();

  add(skill: RegisteredSkill): this {
    this.map.set(skill.def.id, skill);
    return this;
  }

  get(id: string): RegisteredSkill | undefined {
    return this.map.get(id);
  }

  list(): Skill[] {
    return [...this.map.values()].map((s) => s.def);
  }
}

// ── Reference skills ────────────────────────────────────────────────

export const SUMMARIZE: RegisteredSkill = {
  def: {
    id: "summarize",
    name: "summarize",
    description: "summarize text via 0G Compute (qwen-2.5-7b-instruct)",
    tags: ["nlp", "text"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", maxLength: 10_000 } },
    },
    outputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
    },
    pricing: { x402: { token: "USDC", chainId: 8453, amount: "0.01" } }, // 0.01 USDC (decimal)
  },
  handler: async (input: any, ctx) => {
    const { text } = input as { text: string };
    if (typeof text !== "string" || text.length === 0) throw new Error("empty text");
    const { text: out } = await ctx.compute.chat(
      [
        { role: "system", content: "Summarize the user's text in one sentence." },
        { role: "user", content: text },
      ],
      { maxTokens: 120 }
    );
    return { summary: out.trim() };
  },
  streamHandler: async function* (input: any, ctx) {
    const { text } = input as { text: string };
    if (typeof text !== "string" || text.length === 0) throw new Error("empty text");
    let acc = "";
    const messages = [
      { role: "system" as const, content: "Summarize the user's text in one sentence." },
      { role: "user" as const, content: text },
    ];
    // ctx.compute is Compute | DirectCompute; both expose a `stream` async
    // iterator over delta strings. DirectCompute's stream still emits the
    // TEE attestation onto compute.lastTeeAttestation when done.
    const stream = (ctx.compute as any).stream(messages, { maxTokens: 120 });
    for await (const delta of stream) {
      if (typeof delta !== "string" || !delta) continue;
      acc += delta;
      yield delta;
    }
    return { summary: acc.trim() };
  },
};

export const SENTIMENT: RegisteredSkill = {
  def: {
    id: "sentiment",
    name: "sentiment",
    description: "classify text sentiment as positive | neutral | negative",
    tags: ["nlp", "classification"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", maxLength: 5_000 } },
    },
    outputSchema: {
      type: "object",
      properties: {
        label: { type: "string", enum: ["positive", "neutral", "negative"] },
      },
    },
    pricing: { x402: { token: "USDC", chainId: 8453, amount: "0.005" } }, // 0.005 USDC (decimal)
  },
  handler: async (input: any, ctx) => {
    const { text } = input as { text: string };
    const { text: out } = await ctx.compute.chat(
      [
        {
          role: "system",
          content:
            'Classify the user\'s text. Reply with exactly one word: "positive", "neutral", or "negative". No punctuation.',
        },
        { role: "user", content: text },
      ],
      { maxTokens: 6, temperature: 0 }
    );
    const label = out.trim().toLowerCase().replace(/[^a-z]/g, "");
    if (label !== "positive" && label !== "neutral" && label !== "negative")
      return { label: "neutral" };
    return { label };
  },
};

// Sentiment streaming variant — same model, streamed delta-by-delta. Final
// output is normalized to one of the three labels.
SENTIMENT.streamHandler = async function* (input: any, ctx) {
  const { text } = input as { text: string };
  let acc = "";
  const stream = (ctx.compute as any).stream(
    [
      {
        role: "system" as const,
        content:
          'Classify the user\'s text. Reply with exactly one word: "positive", "neutral", or "negative". No punctuation.',
      },
      { role: "user" as const, content: text },
    ],
    { maxTokens: 6 },
  );
  for await (const delta of stream) {
    if (typeof delta !== "string" || !delta) continue;
    acc += delta;
    yield delta;
  }
  const label = acc.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (label !== "positive" && label !== "neutral" && label !== "negative")
    return { label: "neutral" };
  return { label };
};

// ── Swarm: route skill ──────────────────────────────────────────────
//
// `route` is a meta-skill. It takes a tag + payload + hopBudget,
// looks up the downstream agent in ctx.swarm.routingTable, calls that
// agent's actual skill, and returns the downstream output along with a
// RouteHop record. Each hop is itself a fully signed SkillRequest, so
// the entire trace is independently verifiable.
//
// Hop budget hits 0 → handler refuses to forward (prevents cycles).

export const ROUTE: RegisteredSkill = {
  def: {
    id: "route",
    name: "route",
    description: "forward a request to a downstream agent based on tag",
    tags: ["meta", "routing"],
    inputSchema: {
      type: "object",
      required: ["tag"],
      properties: {
        tag: { type: "string", maxLength: 64 },
        payload: {},
        hopBudget: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        output: {},
        trace: { type: "array" },
      },
    },
  },
  handler: async (input: any, ctx): Promise<RouteSkillOutput> => {
    const { tag, payload, hopBudget = 3 } = input as RouteSkillInput;
    if (!ctx.swarm) {
      throw new Error("agent has no swarm config — cannot route");
    }
    if (hopBudget <= 0) {
      throw new Error("hop budget exhausted");
    }
    const route = ctx.swarm.routingTable[tag];
    if (!route) {
      throw new Error(`no route for tag '${tag}'`);
    }

    // If forwarding to another router, propagate decremented budget so
    // chains don't loop forever. Non-route downstreams ignore this.
    const forwardedInput =
      route.skill === "route"
        ? { ...(payload as object), hopBudget: hopBudget - 1 }
        : payload;

    const t0 = Date.now();
    let res;
    try {
      res = await callSkill({
        axl: ctx.swarm.axl,
        destPubkey: route.destPubkey,
        callerPubkey: ctx.swarm.callerPubkey,
        skill: route.skill,
        input: forwardedInput,
        callerINFT: ctx.swarm.callerINFT,
      });
    } catch (e: any) {
      // Surface the failure in the trace then rethrow so the outer
      // SkillResponse path sees an error too. Caller gets a signed
      // failure; the failed hop is now visible in audit logs.
      const failedHop: RouteHop = {
        from: ctx.swarm.callerPubkey,
        to: route.destPubkey,
        skill: route.skill,
        ok: false,
        latencyMs: Date.now() - t0,
        ...(route.ens ? { responderEns: route.ens } : {}),
      };
      throw new Error(
        `route hop failed: ${e?.message ?? e} (trace: ${JSON.stringify([failedHop])})`
      );
    }
    const hop: RouteHop = {
      from: ctx.swarm.callerPubkey,
      to: route.destPubkey,
      skill: route.skill,
      ok: true,
      latencyMs: Date.now() - t0,
      ...(route.ens ? { responderEns: route.ens } : {}),
    };

    // If the downstream itself returned a swarm trace (route → route),
    // splice the traces so the caller sees the full path.
    const downstream = res.output as Partial<RouteSkillOutput> | unknown;
    const isNestedRoute =
      downstream &&
      typeof downstream === "object" &&
      Array.isArray((downstream as any).trace);
    const trace: RouteHop[] = isNestedRoute
      ? [hop, ...((downstream as RouteSkillOutput).trace ?? [])]
      : [hop];
    const output = isNestedRoute ? (downstream as RouteSkillOutput).output : res.output;

    return { output, trace };
  },
};
