import { createPublicClient, createWalletClient, http, toCoinType } from "viem";
import { normalize, namehash } from "viem/ens";
import { mainnet, sepolia, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
const log = (r: Result) => {
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
};

// drpc.org default works for reads + CCIP Read; override for writes/heavy use.
const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? "https://eth.drpc.org";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org";
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC, { timeout: 15_000, retryCount: 2 }),
});
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC, { timeout: 15_000, retryCount: 2 }),
});

async function check(name: string, fn: () => Promise<string | undefined>) {
  try {
    const detail = await fn();
    log({ name, pass: true, detail });
  } catch (e: any) {
    log({ name, pass: false, detail: e?.message ?? String(e) });
  }
}

async function main() {
  // 1. Forward resolve
  await check("forward: nick.eth", async () => {
    const a = await mainnetClient.getEnsAddress({ name: normalize("nick.eth") });
    if (!a) throw new Error("null");
    return a;
  });

  // 2. Text record read
  await check("text: nick.eth com.twitter", async () => {
    const t = await mainnetClient.getEnsText({ name: normalize("nick.eth"), key: "com.twitter" });
    if (!t) throw new Error("null");
    return t;
  });

  // 3. Multichain coinType (Base) — gated, may return null for many names
  await check("multichain: gregskril.eth Base addr", async () => {
    const a = await mainnetClient.getEnsAddress({
      name: normalize("gregskril.eth"),
      coinType: toCoinType(base.id),
    });
    return a ?? "(no Base addr set; coinType call succeeded)";
  });

  // 4. Reverse resolve
  await check("reverse: 0xb8c2...67d5", async () => {
    const n = await mainnetClient.getEnsName({
      address: "0xb8c2C29ee19D8307cb7255e1Cd9CbDE883A267d5",
    });
    return n ?? "(no primary set; call succeeded)";
  });

  // 5. Universal Resolver canary
  await check("UR canary: ur.integration-tests.eth", async () => {
    const a = await mainnetClient.getEnsAddress({ name: normalize("ur.integration-tests.eth") });
    if (a?.toLowerCase() !== "0x2222222222222222222222222222222222222222") {
      throw new Error(`got ${a}, expected 0x2222...`);
    }
    return a;
  });

  // 6. CCIP Read canary
  await check("CCIP-Read canary: test.offchaindemo.eth", async () => {
    const a = await mainnetClient.getEnsAddress({ name: normalize("test.offchaindemo.eth") });
    if (!a) throw new Error("null");
    return a;
  });

  // 7. Card shape round-trip (offline; ensures JSON blob fits the shape we'll publish)
  await check("offline: A2A AgentCard JSON round-trip", async () => {
    const card = {
      protocolVersion: "0.2",
      name: "alice.agentdir.eth",
      description: "demo summarizer",
      url: "axl://<axl_pubkey_hex>",
      skills: [
        {
          id: "summarize",
          name: "summarize",
          description: "summarize text via 0G Compute",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          pricing: { x402: { token: "USDC", chainId: 8453, amount: "10000" } },
        },
      ],
      identity: {
        erc7857: { chainId: 16600, contract: "0x...", tokenId: "1" },
        axlPubkey: "0xabc...",
      },
    };
    const j = JSON.stringify(card);
    const back = JSON.parse(j);
    if (JSON.stringify(back) !== j) throw new Error("not byte-equal");
    return `${j.length} bytes`;
  });

  // 8. Optional write to Sepolia
  if (process.env.WRITE === "1") {
    await check("write: setText on Sepolia (TODO)", async () => {
      if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
      if (!process.env.ENS_NAME) throw new Error("ENS_NAME missing");
      // Stub: implementing this requires owning a Sepolia name and the resolver address.
      // Wire in once we choose path (NameStone vs onchain). Plan doc covers it.
      throw new Error("not implemented in probe scaffold; decide write path first");
    });
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
