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
    this.endpoint = endpoint;
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
    // Resolve a known shipped file via the main entry, walk up to the
    // package root, then dive into lib.commonjs.
    const nodeModule: any = await import("node:module");
    const path = await import("node:path");
    const require_ = nodeModule.createRequire(import.meta.url);
    // Main entry resolves to /<root>/lib.esm/index.mjs; we want
    // /<root>/lib.commonjs/index.js sitting next to it.
    const mainEntry = require_.resolve("@0gfoundation/0g-compute-ts-sdk");
    const pkgRoot = path.resolve(path.dirname(mainEntry), "..");
    const cjs = path.join(pkgRoot, "lib.commonjs", "index.js");
    const { createZGComputeNetworkBroker } = require_(cjs);
    const broker = await createZGComputeNetworkBroker(opts.signer);
    const meta = await broker.inference.getServiceMetadata(opts.provider);
    return new DirectCompute(broker, opts.provider, meta.endpoint, meta.model);
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
    const res = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`0G inference ${res.status}: ${text.slice(0, 300)}`);
    }
    // chatID priority: ZG-Res-Key header → data.id (per docs).
    const headerKey = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");
    const data = (await res.json()) as any;
    const chatID = headerKey ?? data.id ?? "";

    let verified = false;
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
