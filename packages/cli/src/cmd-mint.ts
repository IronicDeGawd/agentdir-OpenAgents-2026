// agentdir mint --handle alice --ens alice.agentdir.eth
// Creates local identity (if missing), then mints an iNFT on 0G Galileo
// with our AXL pubkey + a bytes32(0) initial state root + tokenURI=ens name.
import { ethers } from "ethers";
import { loadOrCreate, saveIdentity } from "@agentdir/agent";
import { loadDeployment } from "./deployment.js";
import { require_ } from "./env.js";

const ABI = [
  "function mint(address to, bytes32 axlPubkey, bytes32 stateRoot, string uri) external returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

export async function mint(args: { handle: string; ens: string; uri?: string }) {
  const dep = loadDeployment();
  const id = await loadOrCreate(args.handle, args.ens);

  const pk = require_("PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(dep.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const inft = new ethers.Contract(dep.AgentdirINFT.address, ABI, wallet);

  const axlPubkey = "0x" + id.axlPubkeyHex; // 32 bytes
  const stateRoot = ethers.ZeroHash;
  const uri = args.uri ?? `ens://${id.ensName}`;

  console.log(`[mint] handle=${id.handle} ens=${id.ensName}`);
  console.log(`[mint] axlPubkey=${axlPubkey}`);
  console.log(`[mint] inft=${dep.AgentdirINFT.address}`);
  console.log(`[mint] sending mint tx...`);

  // 0G Galileo requires min 2 gwei tip. Set legacy + 5 gwei.
  const tx = await inft.mint!(wallet.address, axlPubkey, stateRoot, uri, {
    gasPrice: ethers.parseUnits("5", "gwei"),
  });
  const receipt = await tx.wait();
  console.log(`[mint] tx: ${tx.hash}`);
  console.log(`[mint] block: ${receipt!.blockNumber}`);

  // Decode tokenId from Transfer event
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const log = receipt!.logs.find(
    (l: any) => l.topics[0] === transferTopic && l.address.toLowerCase() === dep.AgentdirINFT.address.toLowerCase()
  );
  if (!log) throw new Error("Transfer event missing");
  const tokenId = BigInt(log.topics[3]).toString();
  console.log(`[mint] tokenId: ${tokenId}`);

  id.inftContract = dep.AgentdirINFT.address;
  id.inftTokenId = tokenId;
  await saveIdentity(id);

  console.log(`[mint] explorer: ${dep.explorer}/tx/${tx.hash}`);
}
