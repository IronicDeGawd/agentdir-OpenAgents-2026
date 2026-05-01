import { ethers } from "ethers";
const PROVIDER = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const c = new ethers.Contract(USDC, ABI, PROVIDER);
const dec = await c.decimals();
const sym = await c.symbol();
for (const a of ["0xb9c58185d09D0aCf3b237cD45C67345E32e628BA", "0x22cBfdaA91D0DC9874dAC0949fa57946dcA2bdE7"]) {
  const b = await c.balanceOf(a);
  console.log(`${a}  ${ethers.formatUnits(b, dec)} ${sym}`);
}
