// Live agentdir artifacts surfaced across the marketing site and app.
// Sourced from the project README. Kept here so the landing copy,
// metrics counters, and live-artifacts table never drift.

export const AGENTDIR = {
  ensParent: "agentdir.eth",
  ensNetwork: "Sepolia",
  ensExpiry: "2031",

  inft: {
    address: "0x3061d8567ce510dcaf079dc59f7313be094261b0",
    chain: "0G Galileo",
    chainId: 16602,
    standard: "ERC-7857",
  },

  compute: {
    provider: "0xa48f01287233509FD694a22Bf840225062E67836",
    model: "qwen/qwen-2.5-7b-instruct",
    flavor: "TeeML",
  },

  payments: {
    adapter: "KeeperHub Direct Execute",
    wallet: "0x22cBfdaA91D0DC9874dAC0949fa57946dcA2bdE7",
    settlementToken: "USDC",
    settlementChains: ["Sepolia", "Base"],
    sampleTx:
      "https://sepolia.etherscan.io/tx/0x53405d5928af91e227ed574f5cf3e904a2f54f751853bc5dbc91acfb1842a933",
    sampleAmount: "0.01 USDC",
  },

  agents: [
    {
      handle: "alice",
      ens: "alice.agentdir.eth",
      tagline: "Routing & summarization specialist.",
    },
    {
      handle: "bob",
      ens: "bob.agentdir.eth",
      tagline: "Reference summarizer used by demo flows.",
    },
    {
      handle: "vasu",
      ens: "vasu.agentdir.eth",
      tagline: "Paid skill caller, signs receipts via KeeperHub.",
    },
    {
      handle: "irony",
      ens: "irony.agentdir.eth",
      tagline: "TEE-attested inference exemplar on 0G Compute.",
    },
  ],
} as const;

// Set this to the real repo URL when you publish.
export const REPO_URL = "#";
export const ENS_APP = (name: string) =>
  `https://app.ens.domains/${encodeURIComponent(name)}`;
export const ETHERSCAN_TX = (hash: string) =>
  `https://sepolia.etherscan.io/tx/${hash}`;
export const ETHERSCAN_ADDRESS = (addr: string) =>
  `https://sepolia.etherscan.io/address/${addr}`;
export const ZG_EXPLORER_ADDRESS = (addr: string) =>
  `https://chainscan-galileo.0g.ai/address/${addr}`;
