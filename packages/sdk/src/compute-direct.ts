// Direct 0G Compute broker integration with TEE verification.
//
// Why this exists separately from `Compute` (the Router-based wrapper):
//   - Router hides provider identity and the ZG-Res-Key response header.
//     It is great for "just run inference" but cannot prove the response
//     came from a TEE-verified provider.
//   - This direct path uses @0glabs/0g-serving-broker against a known
//     provider address, captures the ZG-Res-Key header from the upstream
//     response, and calls broker.inference.processResponse() which both
//     settles the per-call fee on-chain AND validates the TEE attestation
//     for the response. The boolean it returns is what makes a rep
//     attestation "verifiable inference."
//
// Setup (one-time per wallet, see scripts/0g-broker-setup.mjs):
//   1. Wallet has 0G balance on Galileo.
//   2. broker.ledger.depositFund(amount) — main account funded.
//   3. broker.inference.acknowledgeProviderSigner(provider) — required
//      before the first request to that provider.
//   4. broker.inference.transferFund(provider, amount) — sub-account.

import type { Wallet, JsonRpcSigner } from "ethers";

export type DirectComputeChatOpts = {
  maxTokens?: number;
  temperature?: number;
  /** Abort the upstream fetch after this many ms. Default 60s. */
  timeoutMs?: number;
};

export type TeeAttestation = {
  /** Provider EVM address that served the inference. */
  provider: string;
  /** Per-response identifier (ZG-Res-Key header, fallback data.id). */
  chatID: string;
  /** Result of broker.inference.processResponse — true means TEE attestation
   *  validated AND fee settlement succeeded. */
  verified: boolean;
};

export type DirectComputeResult = {
  text: string;
  raw: unknown;
  teeAttestation: TeeAttestation;
};

export type DirectComputeOpts = {
  /** ethers v6 Wallet or JsonRpcSigner (must match the wallet that funded
   *  the broker). The broker SDK only accepts these concrete types. */
  signer: Wallet | JsonRpcSigner;
  /** Provider address to use. Must already be acknowledged + funded. */
  provider: string;
};

/**
 * `Compute`-shaped class (chat / stream) that uses the 0G broker SDK
 * directly. Not a drop-in for OpenAI's SDK — we use plain `fetch` so we
 * can read the ZG-Res-Key response header.
 */
export class DirectCompute {
  readonly broker: any;
  readonly provider: string;
  readonly model: string;
  readonly endpoint: string;

  /** captured for the most recent chat() — useful when callers need it
   *  outside the return tuple. */
  lastTeeAttestation: TeeAttestation | null = null;

  private constructor(broker: any, provider: string, endpoint: string, model: string) {
    this.broker = broker;
    this.provider = provider;
    // Trim trailing slash so `${endpoint}/chat/completions` never doubles up.
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.model = model;
  }

  /**
   * Async factory — required because broker creation + getServiceMetadata
   * are async. Throws if the provider hasn't been acknowledged or funded;
   * callers must run scripts/0g-broker-setup.mjs first.
   */
  static async create(opts: DirectComputeOpts): Promise<DirectCompute> {
    // The ESM bundle (`@0gfoundation/0g-compute-ts-sdk`) ships with a broken
    // re-export ("does not provide an export named 'C'"). The CJS bundle
    // is correct, but the package's exports map blocks subpath access.
    //
    // We use a runtime indirection (`Function('return require')()`) so that
    // bundlers cannot statically see the require call. They leave it as
    // plain JS; at runtime it resolves to Node's real require. Without this
    // hack webpack rewrites `require("node:module")` and friends, breaking
    // both `createRequire` and `node:path`.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const nodeRequire = Function("return require")() as NodeJS.Require;
    const nodePath = nodeRequire("node:path") as typeof import("node:path");
    const mainEntry = nodeRequire.resolve("@0gfoundation/0g-compute-ts-sdk");
    const pkgRoot = nodePath.resolve(nodePath.dirname(mainEntry), "..");
    const cjs = nodePath.join(pkgRoot, "lib.commonjs", "index.js");
    const { createZGComputeNetworkBroker } = nodeRequire(cjs);
    const broker = await createZGComputeNetworkBroker(opts.signer);
    const meta = await broker.inference.getServiceMetadata(opts.provider);
    return new DirectCompute(broker, opts.provider, meta.endpoint, meta.model);
  }

  /**
   * Stream tokens as they arrive from the provider. Yields content deltas
   * (strings); on stream end, populates `lastTeeAttestation` exactly like
   * `chat()`. Calls processResponse once after the final SSE chunk so fee
   * settlement + TEE verification still happen.
   *
   * SSE format follows OpenAI: `data: {json}\n\n`, terminated by
   * `data: [DONE]\n\n`. chatID priority: ZG-Res-Key header → `id` field
   * on the first stream chunk that carries one.
   */
  async *stream(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts: DirectComputeChatOpts = {}
  ): AsyncGenerator<string> {
    const headers = await this.broker.inference.getRequestHeaders(this.provider);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          stream: true,
        }),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      const text = await res.text().catch(() => "");
      throw new Error(`0G inference stream ${res.status}: ${text.slice(0, 300)}`);
    }
    const headerKey = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chatID = headerKey ?? "";
    let lastUsage: unknown = undefined;
    try {
      // SSE framing: events end in a blank line. Some proxies use CRLF;
      // normalize to LF before splitting on \n\n.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const chunk: any = JSON.parse(payload);
              if (!chatID && chunk.id) chatID = chunk.id;
              if (chunk.usage) lastUsage = chunk.usage;
              const delta = chunk.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) yield delta;
            } catch {
              // Drop non-JSON keepalives.
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      // Ensure the underlying socket is released even if the consumer
      // breaks out of the generator early. Without this, the body stream
      // and its socket leak.
      try {
        await reader.cancel();
      } catch {
        /* ignore — reader may already be done */
      }
    }

    let verified = false;
    if (!chatID) {
      // eslint-disable-next-line no-console
      console.warn("[DirectCompute] stream: no ZG-Res-Key or chunk.id; skipping verification");
    } else {
      try {
        const ok = await this.broker.inference.processResponse(
          this.provider,
          chatID,
          lastUsage ? JSON.stringify(lastUsage) : undefined
        );
        verified = ok === undefined ? true : !!ok;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[DirectCompute] stream processResponse failed:", e?.message ?? e);
        verified = false;
      }
    }
    this.lastTeeAttestation = { provider: this.provider, chatID, verified };
  }

  async chat(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts: DirectComputeChatOpts = {}
  ): Promise<DirectComputeResult> {
    // Per-request signed headers expire quickly — fetch fresh every call.
    const headers = await this.broker.inference.getRequestHeaders(this.provider);

    const body = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`0G inference ${res.status}: ${text.slice(0, 300)}`);
    }
    // chatID priority: ZG-Res-Key header → data.id (per docs).
    const headerKey = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");
    const data = (await res.json()) as any;
    const chatID = headerKey ?? data.id ?? "";

    let verified = false;
    if (!chatID) {
      // No identifier we can submit to processResponse → cannot validate.
      // Skip the broker call rather than feed it garbage.
      // eslint-disable-next-line no-console
      console.warn("[DirectCompute] no ZG-Res-Key header or data.id; skipping verification");
    } else {
      try {
        const ok = await this.broker.inference.processResponse(
          this.provider,
          chatID,
          data.usage ? JSON.stringify(data.usage) : undefined
        );
        // Some broker versions return true/false; some return void on success
        // and throw on failure. Treat undefined-without-throw as verified.
        verified = ok === undefined ? true : !!ok;
      } catch (e: any) {
        // Settlement / verification failed. The text is still legible to the
        // caller, but the attestation is now verified=false. Caller decides
        // whether to use the output anyway (the agent runtime does — and
        // surfaces verified=false in the rep attestation).
        // eslint-disable-next-line no-console
        console.error("[DirectCompute] processResponse failed:", e?.message ?? e);
        verified = false;
      }
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    const teeAttestation: TeeAttestation = {
      provider: this.provider,
      chatID,
      verified,
    };
    this.lastTeeAttestation = teeAttestation;
    return { text, raw: data, teeAttestation };
  }
}
