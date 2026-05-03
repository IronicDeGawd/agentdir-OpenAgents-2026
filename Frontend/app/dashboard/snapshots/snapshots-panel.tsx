"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useSignMessage,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import { useMyAgents, type MyAgent } from "@/lib/use-my-agents";
import { GALILEO_CHAIN_ID } from "@/lib/wagmi";
import { AGENTDIR_INFT_ADDRESS, INFT_ABI } from "@/lib/galileo";

type StateEvent = {
  prevRoot: string;
  newRoot: string;
  by: string;
  blockNumber: number;
  txHash: string;
};

function shortHex(s: string, n = 8): string {
  if (!s || s.length < 2 * n + 2) return s;
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`;
}

export function SnapshotsPanel({ initialEns }: { initialEns: string | null }) {
  const { address, isConnected, agents, loading: agentsLoading } = useMyAgents();
  const [ens, setEns] = useState<string | null>(initialEns);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [history, setHistory] = useState<StateEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rotating, setRotating] = useState<
    "idle" | "challenge" | "snapshot" | "tx" | "done" | "error"
  >("idle");
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);
  const [rotateTx, setRotateTx] = useState<string | null>(null);

  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  // Default to first owned agent
  useEffect(() => {
    if (!ens && agents.length > 0) setEns(agents[0].ens);
  }, [agents, ens]);

  // Resolve tokenId from /api/agents/<ens>
  useEffect(() => {
    if (!ens) return;
    (async () => {
      try {
        const r = await fetch(`/api/agents/${encodeURIComponent(ens)}`, {
          cache: "no-store",
        });
        const j = await r.json();
        const id = j?.card?.identity?.erc7857?.tokenId ?? null;
        setTokenId(id);
      } catch (e) {
        setErr(`load tokenId failed: ${(e as Error).message}`);
      }
    })();
  }, [ens]);

  const loadHistory = useCallback(async () => {
    if (!tokenId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/state-history?token=${tokenId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "history failed");
      setHistory(j.events ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    if (tokenId) loadHistory();
  }, [tokenId, loadHistory]);

  const rotate = useCallback(async () => {
    if (!ens || !address || !tokenId) return;
    setErr(null);
    setRotateTx(null);
    setPendingRoot(null);
    try {
      // 1. Server challenge
      setRotating("challenge");
      const ch = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "snapshot", ownerAddress: address, ens }),
      });
      const challenge = (await ch.json()) as { message: string; error?: string };
      if (!ch.ok) throw new Error(challenge.error ?? "challenge failed");
      const sig = await signMessageAsync({ message: challenge.message });

      // 2. Build + upload snapshot server-side
      setRotating("snapshot");
      const handle = ens.split(".")[0];
      const snap = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          ownerAddress: address,
          message: challenge.message,
          signature: sig,
        }),
      });
      const snapJson = await snap.json();
      if (!snap.ok) throw new Error(snapJson.error ?? "snapshot failed");
      const root: string = snapJson.root;
      setPendingRoot(root);

      // 3. User-signed setAgentStateRoot on Galileo
      setRotating("tx");
      await switchChainAsync({ chainId: GALILEO_CHAIN_ID });
      const rootHex = (root.startsWith("0x") ? root : "0x" + root) as `0x${string}`;
      const txHash = await writeContractAsync({
        chainId: GALILEO_CHAIN_ID,
        address: AGENTDIR_INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "setAgentStateRoot",
        args: [BigInt(tokenId), rootHex],
      });
      setRotateTx(txHash);
      setRotating("done");
      // Refresh history after a beat
      setTimeout(() => loadHistory(), 8000);
    } catch (e) {
      setRotating("error");
      setErr((e as Error).message);
    }
  }, [ens, address, tokenId, signMessageAsync, switchChainAsync, writeContractAsync, loadHistory]);

  if (!isConnected) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <h2 className="text-xl font-display mb-2">Connect a wallet</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Snapshots are signed by your wallet (the iNFT owner).
        </p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-8">
      <aside>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Pick agent
        </h3>
        {agentsLoading ? (
          <div className="font-mono text-xs text-muted-foreground">loading…</div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No owned agents.{" "}
            <Link href="/mint" className="underline">
              Mint one
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-1">
            {agents.map((a: MyAgent) => (
              <button
                key={a.ens}
                onClick={() => setEns(a.ens)}
                className={`w-full text-left font-mono text-xs px-3 py-2 border transition-colors ${
                  ens === a.ens
                    ? "border-foreground bg-foreground/5"
                    : "border-foreground/10 hover:border-foreground/40"
                }`}
              >
                {a.ens}
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="space-y-6">
        {ens && (
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-display">{ens}</h2>
            {tokenId && (
              <span className="font-mono text-xs text-muted-foreground">
                tokenId #{tokenId}
              </span>
            )}
          </div>
        )}

        {err && (
          <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-xs text-destructive">
            {err}
          </div>
        )}

        {ens && tokenId && (
          <div className="border border-foreground/10 px-5 py-5 space-y-3">
            <h3 className="text-base font-display">Rotate memory snapshot</h3>
            <p className="text-sm text-muted-foreground">
              Server-signed snapshot blob → 0G Storage → on-chain anchor via{" "}
              <code className="font-mono">setAgentStateRoot</code>. You sign
              both the server intent (off-chain message) and the on-chain tx.
            </p>
            <Button
              onClick={rotate}
              disabled={rotating !== "idle" && rotating !== "done" && rotating !== "error"}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {rotating === "challenge" && "signing intent…"}
              {rotating === "snapshot" && "uploading to 0G…"}
              {rotating === "tx" && "awaiting tx…"}
              {rotating === "done" && "rotated ✓"}
              {(rotating === "idle" || rotating === "error") && "Rotate snapshot"}
            </Button>
            {pendingRoot && (
              <div className="font-mono text-xs text-muted-foreground">
                root: {shortHex(pendingRoot, 12)}
              </div>
            )}
            {rotateTx && (
              <div className="font-mono text-xs">
                tx:{" "}
                <a
                  className="underline"
                  href={`https://chainscan-galileo.0g.ai/tx/${rotateTx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHex(rotateTx)}
                </a>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-display">State-root history</h3>
            <button
              onClick={loadHistory}
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              refresh
            </button>
          </div>
          {loading ? (
            <div className="font-mono text-xs text-muted-foreground">loading…</div>
          ) : history.length === 0 ? (
            <div className="font-mono text-xs text-muted-foreground">
              no rotations yet
            </div>
          ) : (
            <div className="space-y-2">
              {history
                .slice()
                .reverse()
                .map((e) => (
                  <div
                    key={e.txHash}
                    className="border border-foreground/10 px-4 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-4 font-mono text-xs"
                  >
                    <span className="text-muted-foreground">block {e.blockNumber}</span>
                    <span>
                      {shortHex(e.prevRoot, 6)} → <strong>{shortHex(e.newRoot, 6)}</strong>
                    </span>
                    <a
                      className="underline text-muted-foreground hover:text-foreground"
                      href={`https://chainscan-galileo.0g.ai/tx/${e.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      tx
                    </a>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
