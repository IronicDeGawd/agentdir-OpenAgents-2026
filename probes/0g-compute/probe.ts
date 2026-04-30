import OpenAI from "openai";

const BASE_URL =
  process.env.ZEROG_BASE_URL ?? "https://router-api-testnet.integratenetwork.work/v1";
const MODEL = process.env.ZEROG_MODEL ?? "zai-org/GLM-5-FP8";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
const log = (r: Result) => {
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
};
async function check(name: string, fn: () => Promise<string | undefined>) {
  try {
    const detail = await fn();
    log({ name, pass: true, detail });
  } catch (e: any) {
    log({ name, pass: false, detail: e?.message ?? String(e) });
  }
}

async function main() {
  if (!process.env.ZEROG_API_KEY) {
    console.error("ZEROG_API_KEY missing");
    process.exit(2);
  }

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: process.env.ZEROG_API_KEY });

  // 1. Reachability via cheap call
  await check("router reachable + auth ok", async () => {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "respond with the single word PONG" }],
      max_tokens: 5,
    });
    const txt = r.choices[0]?.message?.content ?? "";
    if (!txt) throw new Error("empty");
    return txt.trim();
  });

  // 2. Streaming
  await check("streaming completion", async () => {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "count to 3" }],
      max_tokens: 16,
      stream: true,
    });
    let chunks = 0;
    for await (const _c of stream) chunks++;
    if (chunks < 1) throw new Error("no chunks");
    return `${chunks} chunks`;
  });

  // 3. 401 when key bogus
  await check("rejects bogus key with 401", async () => {
    const bad = new OpenAI({ baseURL: BASE_URL, apiKey: "sk-bogus-key" });
    try {
      await bad.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 4,
      });
      throw new Error("should have rejected");
    } catch (e: any) {
      if (e?.status === 401 || /401|unauth/i.test(String(e?.message))) return "401 ok";
      throw e;
    }
  });

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
