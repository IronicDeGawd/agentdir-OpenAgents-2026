// Skill registry. Each skill = {def, handler}. Pluggable per agent.
import type { Compute, DirectCompute } from "@agentdir/sdk";
import type { Skill } from "@agentdir/sdk";

/** Compute that skill handlers see. Either Router (Compute) or
 *  TEE-direct (DirectCompute). Both expose `chat({...})` and
 *  `lastTeeAttestation` so the agent runtime can read attestation
 *  metadata without an instanceof check. */
export type SkillCtx = { compute: Compute | DirectCompute };
export type SkillHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: SkillCtx
) => Promise<O>;

export type RegisteredSkill = {
  def: Skill;
  handler: SkillHandler;
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
