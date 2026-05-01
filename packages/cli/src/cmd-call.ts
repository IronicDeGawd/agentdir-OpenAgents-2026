// agentdir call --to <peerPubkey> --skill summarize --input '{"text":"..."}' [--from alice]
//   [--pay 0.05 --pay-recipient 0x... --pay-network 11155111 --pay-token 0x...]
//
// Fires a SkillRequest, prints the verified response. With --pay set, runs
// a real KH Direct Execute USDC transfer first and attaches the signed
// receipt to the request.
import { AxlClient, KhDirectExecuteAdapter } from "@agentdir/sdk";
import { callSkill, loadOrCreate, signDigest } from "@agentdir/agent";
import { require_ } from "./env.js";

const SEPOLIA = "11155111";
const DEFAULT_USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export async function call(args: {
  from: string;
  to: string;
  skill: string;
  input: string;
  axlBase?: string;
  callerINFT?: string;
  pay?: string;
  payRecipient?: string;
  payNetwork?: string;
  payToken?: string;
}) {
  const id = await loadOrCreate(args.from, null);
  const axl = new AxlClient(args.axlBase ?? "http://127.0.0.1:9002");

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(args.input);
  } catch {
    console.error("--input must be valid JSON");
    process.exit(2);
  }

  console.log(`[call] from=${id.handle} (${id.axlPubkeyHex.slice(0, 8)}…) → to=${args.to.slice(0, 8)}…`);
  console.log(`[call] skill=${args.skill}`);

  // Optional payment. Settles via KH Direct Execute, signs receipt with
  // caller's AXL key, attaches to the SkillRequest envelope.
  let payment: any = undefined;
  if (args.pay) {
    if (!args.payRecipient) {
      console.error("--pay requires --pay-recipient <0x...>");
      process.exit(2);
    }
    const network = args.payNetwork ?? SEPOLIA;
    const tokenAddress = args.payToken ?? (network === SEPOLIA ? DEFAULT_USDC_SEPOLIA : "");
    if (!tokenAddress) {
      console.error("--pay-token required when --pay-network is non-default");
      process.exit(2);
    }
    const adapter = new KhDirectExecuteAdapter({
      apiKey: require_("KEEPERHUB_ORG_KEY"),
      tokenAddress,
      tokenSymbol: "USDC",
      network,
    });
    console.log(`[call] settling ${args.pay} USDC → ${args.payRecipient} on chain ${network}…`);
    const receipt = await adapter.settle({
      amount: args.pay,
      recipient: args.payRecipient,
      skill: args.skill,
      callerPubkey: id.axlPubkeyHex,
      signer: (digest) => signDigest(id, digest),
    });
    console.log(`[call] paid: tx ${receipt.txHash}`);
    payment = receipt;
  }

  const t0 = Date.now();
  const res = await callSkill({
    axl,
    destPubkey: args.to,
    callerPubkey: id.axlPubkeyHex,
    skill: args.skill,
    input: parsedInput,
    callerINFT: args.callerINFT ?? id.inftTokenId,
    payment,
  });
  console.log(`[call] ok in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(res.output, null, 2));
}
