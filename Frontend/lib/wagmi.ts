"use client";

import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Single-chain config — Sepolia is enough for the mint flow because
// gas-paying mint happens server-side on 0G Galileo via PRIVATE_KEY.
// User wallet only needs to sign nothing on-chain in the current B5
// scope (we only read their address). Future: add Galileo for self-mint.
export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [sepolia.id]: http(
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com",
    ),
  },
  ssr: true,
});
