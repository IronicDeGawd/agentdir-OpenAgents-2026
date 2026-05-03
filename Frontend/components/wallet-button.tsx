"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => disconnect()}
        className="font-mono text-xs"
      >
        {shortAddr(address)} • disconnect
      </Button>
    );
  }

  const mm = connectors.find((c) => c.id === "metaMask") ?? connectors[0];
  return (
    <Button
      variant="default"
      size="sm"
      disabled={!mm || isPending}
      onClick={() => mm && connect({ connector: mm })}
      className="font-mono text-xs"
    >
      {isPending ? "connecting…" : "connect wallet"}
    </Button>
  );
}
