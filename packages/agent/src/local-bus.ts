// In-process local bus for demos. Same API surface as AxlClient
// (sendJson, recvOnce, topology) so Agent + callSkill are transport-agnostic.
//
// Use this when you don't want to spin up a real AXL mesh — e.g. for
// local 2-agent demos. Production deployments swap in AxlClient.

type Inbox = {
  pubkey: string;
  queue: { from: string; body: string }[];
};

const buses = new Map<string, Inbox>();

/** Resets the global bus — useful for tests. */
export function resetLocalBus() {
  buses.clear();
}

export class LocalBusClient {
  constructor(public readonly pubkey: string) {
    if (!buses.has(pubkey)) buses.set(pubkey, { pubkey, queue: [] });
  }

  async ourPubkey() {
    return this.pubkey;
  }

  async topology() {
    return { our_ipv6: "", our_public_key: this.pubkey } as any;
  }

  async send(to: string, body: BodyInit, _ct?: string) {
    const dest = buses.get(to);
    if (!dest) throw new Error(`local-bus: no inbox for ${to}`);
    const text = typeof body === "string" ? body : new TextDecoder().decode(body as any);
    dest.queue.push({ from: this.pubkey, body: text });
  }

  async sendJson(to: string, value: unknown) {
    return this.send(to, JSON.stringify(value));
  }

  async recvOnce() {
    const me = buses.get(this.pubkey);
    if (!me) return null;
    return me.queue.shift() ?? null;
  }

  async recv(timeoutMs = 30_000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await this.recvOnce();
      if (m) return m;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("recv timeout");
  }

  async mcp() {
    throw new Error("LocalBus does not implement MCP transport");
  }

  async a2aCard() {
    throw new Error("LocalBus does not implement A2A card transport");
  }
}
