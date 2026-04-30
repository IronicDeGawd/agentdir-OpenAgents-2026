// Thin client for the local AXL node HTTP bridge.
// Per Gensyn docs: every agentdir agent runs an AXL node and talks to
// localhost:9002. Inter-agent traffic flows over the encrypted overlay.

const DEFAULT_BASE = "http://127.0.0.1:9002";

export type Topology = {
  our_ipv6: string;
  our_public_key: string;
  peers?: { uri: string; up: boolean; inbound: boolean; public_key: string }[];
  tree?: unknown;
};

export class AxlClient {
  constructor(public readonly base: string = DEFAULT_BASE) {}

  async topology(): Promise<Topology> {
    const r = await fetch(`${this.base}/topology`);
    if (!r.ok) throw new Error(`topology: ${r.status}`);
    return r.json();
  }

  async ourPubkey(): Promise<string> {
    return (await this.topology()).our_public_key;
  }

  /** Fire-and-forget raw bytes to a peer. Body may be Buffer/string/json. */
  async send(destPubkey: string, body: BodyInit, contentType?: string): Promise<void> {
    const headers: Record<string, string> = { "X-Destination-Peer-Id": destPubkey };
    if (contentType) headers["Content-Type"] = contentType;
    const r = await fetch(`${this.base}/send`, { method: "POST", headers, body });
    if (!r.ok) throw new Error(`send: ${r.status} ${await r.text()}`);
  }

  async sendJson(destPubkey: string, value: unknown): Promise<void> {
    return this.send(destPubkey, JSON.stringify(value), "application/json");
  }

  /**
   * Poll once. Returns null on 204 (queue empty).
   * Caller's responsibility to loop with backoff. Senders/receivers must agree
   * on framing — we use JSON unless `raw: true`.
   */
  async recvOnce(): Promise<{ from: string; body: string } | null> {
    const r = await fetch(`${this.base}/recv`);
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`recv: ${r.status}`);
    const from = r.headers.get("X-From-Peer-Id") ?? "";
    return { from, body: await r.text() };
  }

  /** Convenience: long-poll until message arrives or timeout. */
  async recv(timeoutMs = 30_000, intervalMs = 500): Promise<{ from: string; body: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await this.recvOnce();
      if (m) return m;
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    throw new Error("recv timeout");
  }

  /** JSON-RPC over MCP envelope to peer's named service. */
  async mcp<T = unknown>(
    destPubkey: string,
    service: string,
    request: { jsonrpc: "2.0"; method: string; id: number | string; params?: unknown }
  ): Promise<T> {
    const r = await fetch(`${this.base}/mcp/${destPubkey}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!r.ok) throw new Error(`mcp: ${r.status} ${await r.text()}`);
    return r.json();
  }

  /** Fetch peer's A2A agent card via the AXL bridge. */
  async a2aCard(destPubkey: string): Promise<unknown> {
    const r = await fetch(`${this.base}/a2a/${destPubkey}`);
    if (!r.ok) throw new Error(`a2a card: ${r.status}`);
    return r.json();
  }
}
