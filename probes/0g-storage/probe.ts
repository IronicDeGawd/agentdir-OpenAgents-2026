import { ethers } from "ethers";
// Note: import names per 0g-reference.md §6.1
import { Indexer, MemData, Batcher, KvClient, getFlowContract } from "@0gfoundation/0g-ts-sdk";

const RPC_URL = "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";

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
  if (!process.env.PRIVATE_KEY) {
    console.error("PRIVATE_KEY missing");
    process.exit(2);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const indexer = new Indexer(INDEXER_RPC);

  // 1. Indexer reachable
  await check("indexer reachable", async () => {
    const [nodes, err] = await indexer.selectNodes(1);
    if (err !== null) throw new Error(String(err));
    return `${nodes?.length ?? 0} nodes selected`;
  });

  // 2 + 3. Upload + download round-trip
  let rootHash: string | undefined;
  const payload = new TextEncoder().encode(
    JSON.stringify({ test: "agentdir-probe", ts: Date.now() })
  );

  await check("upload MemData → rootHash", async () => {
    const memData = new MemData(payload);
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) throw new Error(`merkleTree: ${treeErr}`);
    rootHash = tree?.rootHash() as string | undefined;
    if (!rootHash) throw new Error("no rootHash");
    const [, err] = await indexer.upload(memData, RPC_URL, signer);
    if (err !== null) throw new Error(`upload: ${err}`);
    return rootHash;
  });

  await check("download by rootHash matches", async () => {
    if (!rootHash) throw new Error("no rootHash from upload step");
    // download writes to disk; spec uses (rootHash, outputPath, withProof)
    const tmp = `./.work-download-${Date.now()}.bin`;
    const err = await indexer.download(rootHash, tmp, true);
    if (err !== null) throw new Error(String(err));
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(tmp);
    await fs.unlink(tmp).catch(() => {});
    if (Buffer.compare(buf, Buffer.from(payload)) !== 0) throw new Error("bytes differ");
    return "ok";
  });

  // 4. KV stream set/get — DEFERRED: KvClient endpoint flaky on testnet.
  // Reputation log will use append-only file uploads (rootHash chain) as primary path,
  // KV as v2 enhancement. Re-enable when 0g-agent-skills publishes canonical pattern.
  if (process.env.RUN_KV === "1") await check("KV stream set + get", async () => {
    const [nodes, err] = await indexer.selectNodes(1);
    if (err !== null) throw new Error(String(err));
    const flowAddr = process.env.FLOW_CONTRACT ?? "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";
    const flow = getFlowContract(flowAddr, signer);
    const batcher = new Batcher(1, nodes!, flow, RPC_URL);
    // streamId must be bytes32 hex
    const streamId = ethers.id(`agentdir-probe-${Date.now()}`);
    const k = new TextEncoder().encode("rep:alice");
    const v = new TextEncoder().encode(JSON.stringify({ score: 0.92, n: 3 }));
    batcher.streamDataBuilder.set(streamId, k, v);
    const [, batchErr] = await batcher.exec();
    if (batchErr !== null) throw new Error(String(batchErr));
    // Best-effort read; tolerate eventual consistency
    const kv = new KvClient("http://3.101.147.150:6789");
    // KV is eventual; allow up to 10s for replication
    let got: any = null;
    for (let i = 0; i < 10; i++) {
      got = await kv.getValue(streamId, ethers.hexlify(k));
      if (got && got.data) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!got || !got.data) throw new Error("read returned empty after 10s");
    return `streamId=${streamId}`;
  });
  if (process.env.RUN_KV !== "1") {
    console.log("SKIP  KV stream set + get  — endpoint flaky; set RUN_KV=1 to attempt");
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
