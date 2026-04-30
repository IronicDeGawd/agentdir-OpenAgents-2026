// 0G Compute Router wrapper. Drop-in OpenAI client.
// Default model = qwen/qwen-2.5-7b-instruct (TEE-verified, 1 active provider
// on Galileo testnet at writing). Override via opts.model.

import OpenAI from "openai";

const TESTNET_BASE = "https://router-api-testnet.integratenetwork.work/v1";
const MAINNET_BASE = "https://router-api.0g.ai/v1";
const DEFAULT_MODEL = "qwen/qwen-2.5-7b-instruct";

export type ComputeOpts = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  network?: "mainnet" | "testnet";
};

export class Compute {
  readonly client: OpenAI;
  readonly model: string;

  constructor(opts: ComputeOpts) {
    const base =
      opts.baseUrl ?? (opts.network === "mainnet" ? MAINNET_BASE : TESTNET_BASE);
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: base });
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async chat(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<{ text: string; raw: unknown }> {
    const r = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: opts?.maxTokens,
      temperature: opts?.temperature,
    });
    return { text: r.choices[0]?.message?.content ?? "", raw: r };
  }

  async *stream(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number }
  ): AsyncGenerator<string> {
    const s = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: opts?.maxTokens,
      stream: true,
    });
    for await (const chunk of s) {
      const t = chunk.choices[0]?.delta?.content;
      if (t) yield t;
    }
  }
}
