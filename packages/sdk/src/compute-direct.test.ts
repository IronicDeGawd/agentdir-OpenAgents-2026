import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectCompute } from "./compute-direct.js";

// Build a DirectCompute with stubbed broker + endpoint, bypassing
// the real broker SDK (which needs ethers + onchain ledger funding).
function makeStub(
  brokerOverrides: Partial<{
    getRequestHeaders: (p: string) => Promise<Record<string, string>>;
    processResponse: (p: string, c: string, u?: string) => Promise<boolean | void>;
  }> = {},
  endpoint = "https://provider.example/v1"
): DirectCompute {
  const broker: any = {
    inference: {
      getRequestHeaders:
        brokerOverrides.getRequestHeaders ??
        (async () => ({ "x-zg-auth": "stub" })),
      processResponse:
        brokerOverrides.processResponse ?? (async () => true),
    },
  };
  // Reach into the private constructor.
  return new (DirectCompute as any)(
    broker,
    "0xprovider",
    endpoint,
    "qwen/qwen-2.5-7b-instruct"
  ) as DirectCompute;
}

test("chat() captures ZG-Res-Key + sets verified=true on processResponse success", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "fallback-id-ignored",
        choices: [{ message: { content: "hi from tee" } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "ZG-Res-Key": "chat-xyz-1" },
      }
    )) as any;
  try {
    let captured: { p: string; c: string; u?: string } | null = null;
    const dc = makeStub({
      processResponse: async (p, c, u) => {
        captured = { p, c, u };
        return true;
      },
    });
    const res = await dc.chat([{ role: "user", content: "hi" }]);
    assert.equal(res.text, "hi from tee");
    assert.equal(res.teeAttestation.verified, true);
    assert.equal(res.teeAttestation.chatID, "chat-xyz-1");
    assert.equal(res.teeAttestation.provider, "0xprovider");
    assert.deepEqual(captured, {
      p: "0xprovider",
      c: "chat-xyz-1",
      u: '{"prompt_tokens":5,"completion_tokens":3}',
    });
    assert.equal(dc.lastTeeAttestation?.verified, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("chat() falls back to data.id when ZG-Res-Key header absent", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "body-id-42",
        choices: [{ message: { content: "x" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as any;
  try {
    const dc = makeStub();
    const res = await dc.chat([{ role: "user", content: "hi" }]);
    assert.equal(res.teeAttestation.chatID, "body-id-42");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("chat() skips processResponse + verified=false when no chatID", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "x" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as any;
  try {
    let called = false;
    const dc = makeStub({
      processResponse: async () => {
        called = true;
        return true;
      },
    });
    const res = await dc.chat([{ role: "user", content: "hi" }]);
    assert.equal(called, false);
    assert.equal(res.teeAttestation.verified, false);
    assert.equal(res.teeAttestation.chatID, "");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("chat() verified=false when broker.processResponse throws", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "x" } }],
      }),
      { status: 200, headers: { "ZG-Res-Key": "id-1" } }
    )) as any;
  try {
    const dc = makeStub({
      processResponse: async () => {
        throw new Error("settlement failed");
      },
    });
    const res = await dc.chat([{ role: "user", content: "hi" }]);
    assert.equal(res.teeAttestation.verified, false);
    assert.equal(res.teeAttestation.chatID, "id-1");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("chat() throws on non-2xx upstream", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("rate limited", { status: 429 })) as any;
  try {
    const dc = makeStub();
    await assert.rejects(
      () => dc.chat([{ role: "user", content: "hi" }]),
      /0G inference 429/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("stream() yields deltas + populates lastTeeAttestation on completion", async () => {
  const sse =
    'data: {"id":"chat-stream-1","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n' +
    "data: [DONE]\n\n";
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "ZG-Res-Key": "stream-1" },
    });
  }) as any;
  try {
    let captured: { p: string; c: string; u?: string } | null = null;
    const dc = makeStub({
      processResponse: async (p, c, u) => {
        captured = { p, c, u };
        return true;
      },
    });
    const out: string[] = [];
    for await (const t of dc.stream([{ role: "user", content: "hi" }])) out.push(t);
    assert.equal(out.join(""), "Hello world");
    assert.equal(dc.lastTeeAttestation?.verified, true);
    assert.equal(dc.lastTeeAttestation?.chatID, "stream-1");
    assert.deepEqual(captured, {
      p: "0xprovider",
      c: "stream-1",
      u: '{"prompt_tokens":4,"completion_tokens":2}',
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("stream() falls back to chunk.id when header missing", async () => {
  const sse =
    'data: {"id":"chunk-id-7","choices":[{"delta":{"content":"a"}}]}\n\n' +
    "data: [DONE]\n\n";
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      },
    });
    return new Response(s, { status: 200 });
  }) as any;
  try {
    const dc = makeStub();
    const out: string[] = [];
    for await (const t of dc.stream([{ role: "user", content: "hi" }])) out.push(t);
    assert.equal(out.join(""), "a");
    assert.equal(dc.lastTeeAttestation?.chatID, "chunk-id-7");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("stream() endpoint trailing slash trimmed in chat()/stream()", async () => {
  const dc = makeStub({}, "https://provider.example/v1///");
  // Verify the trim happened in the constructor.
  assert.equal((dc as any).endpoint, "https://provider.example/v1");
});
