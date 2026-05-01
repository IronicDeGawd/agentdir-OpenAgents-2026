// agentdir whoami [--handle alice]
// Prints local agent identity (does NOT touch network).
import { loadOrCreate } from "@agentdir/agent";

export async function whoami(args: { handle?: string }) {
  const handle = args.handle ?? "alice";
  // Pass null so we don't accidentally trigger ENS-mismatch error;
  // user just wants to know what's on disk.
  try {
    const id = await loadOrCreate(handle, null);
    console.log(JSON.stringify({
      handle: id.handle,
      ensName: id.ensName,
      axlPubkeyHex: id.axlPubkeyHex,
      inftContract: id.inftContract,
      inftTokenId: id.inftTokenId,
    }, null, 2));
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}
