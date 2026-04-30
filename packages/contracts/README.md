# @agentdir/contracts

Foundry project for the agentdir on-chain contracts.

## Contracts

- `IERC7857.sol` — minimal ERC-7857 interface (state root + AXL pubkey + events).
- `AgentdirINFT.sol` — ERC-721 + ERC-7857. One token per agent, owner-mutable
  state root / pubkey / URI. Transfer = move agent identity.

## First-time setup

`lib/` is gitignored. After cloning:

```bash
cd packages/contracts
forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
```

## Build + test

```bash
forge build
forge test -vv
```

## Deploy (0G Galileo testnet)

```bash
set -a; . ../../.env.local; set +a
forge script script/Deploy.s.sol:Deploy \
  --rpc-url zerog_testnet \
  --broadcast
```

## Why ERC-7857 + ERC-721

ERC-7857 anchors mutable agent state (memory rootHash + ed25519 pubkey) on
chain while keeping the bulk of state off-chain on 0G Storage. ERC-721
provides standard ownership/transfer semantics — a transferred token transfers
the *whole* agent (memory, identity, earnings authority).

Deployment lives on 0G Chain (Galileo testnet, chainId 16600) per 0G iNFT
track requirements. SDK reads `agentStateRoot` to confirm freshness of any
loaded memory blob from 0G Storage.
