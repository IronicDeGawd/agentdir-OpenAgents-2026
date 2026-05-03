"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { isAddress } from "viem";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import { useMyAgents } from "@/lib/use-my-agents";
import { GALILEO_CHAIN_ID } from "@/lib/wagmi";
import { AGENTDIR_INFT_ADDRESS, INFT_ABI } from "@/lib/galileo";

function shortHex(s: string, n = 8) {
  if (!s || s.length < 2 * n + 2) return s;
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`;
}

export function TransferPanel() {
  const { address, isConnected, agents, loading } = useMyAgents();
  const [ens, setEns] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  useEffect(() => {
    if (!ens && agents.length) setEns(agents[0].ens);
  }, [agents, ens]);

  useEffect(() => {
    if (!ens) return;
    fetch(`/api/agents/${encodeURIComponent(ens)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTokenId(j?.card?.identity?.erc7857?.tokenId ?? null))
      .catch(() => {});
  }, [ens]);

  const transfer = useCallback(async () => {
    if (!address || !tokenId || !isAddress(recipient) || !confirmed) return;
    setBusy(true);
    setErr(null);
    setTx(null);
    try {
      await switchChainAsync({ chainId: GALILEO_CHAIN_ID });
      const txHash = await writeContractAsync({
        chainId: GALILEO_CHAIN_ID,
        address: AGENTDIR_INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "transferFrom",
        args: [address as `0x${string}`, recipient as `0x${string}`, BigInt(tokenId)],
      });
      setTx(txHash);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [address, tokenId, recipient, confirmed, writeContractAsync, switchChainAsync]);

  if (!isConnected) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <h2 className="text-xl font-display mb-2">Connect a wallet</h2>
        <WalletButton />
      </div>
    );
  }

  if (loading) {
    return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-8">
      <aside>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Pick agent
        </h3>
        {agents.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No owned agents.{" "}
            <Link href="/mint" className="underline">
              Mint one
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-1">
            {agents.map((a) => (
              <button
                key={a.ens}
                onClick={() => {
                  setEns(a.ens);
                  setRecipient("");
                  setConfirmed(false);
                  setTx(null);
                }}
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

        <div className="border border-destructive/40 bg-destructive/5 px-5 py-4 text-sm">
          <strong>Warning.</strong> Transferring the iNFT moves: state-root
          rotation authority, AXL pubkey rotation authority, and ENS records
          control (when the recipient also gets the parent name). Server keeps
          hosting the runtime under the new owner. This is irreversible from
          our side.
        </div>

        <div className="border border-foreground/10 px-5 py-5 space-y-4">
          <h3 className="text-base font-display">Transfer to address</h3>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder="0x…"
            disabled={busy}
            className="w-full bg-background border border-foreground/20 px-3 py-2 font-mono text-sm focus:outline-none focus:border-foreground/60"
          />
          <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
              className="mt-1"
            />
            I understand this transfers full agent authority and cannot be
            reversed by agentdir.
          </label>
          <Button
            onClick={transfer}
            disabled={
              busy || !confirmed || !isAddress(recipient) || !tokenId
            }
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {busy ? "submitting…" : "Transfer iNFT"}
          </Button>
          {err && (
            <div className="font-mono text-xs text-destructive">{err}</div>
          )}
          {tx && (
            <div className="font-mono text-xs">
              tx:{" "}
              <a
                className="underline"
                href={`https://chainscan-galileo.0g.ai/tx/${tx}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(tx)}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
