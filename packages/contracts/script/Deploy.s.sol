// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentdirINFT} from "../src/AgentdirINFT.sol";

contract Deploy is Script {
    /// @dev Set ALLOW_CHAIN env var to skip the chain assertion.
    function run() external {
        if (vm.envOr("ALLOW_CHAIN", uint256(0)) == 0) {
            // 0G Galileo testnet only. Override with ALLOW_CHAIN=1 if you
            // really want to deploy elsewhere.
            require(block.chainid == 16600, "Deploy: wrong chain (expected 0G Galileo 16600)");
        }
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        AgentdirINFT inft = new AgentdirINFT(deployer);
        vm.stopBroadcast();
        console.log("AgentdirINFT deployed at:", address(inft));
        console.log("Owner:", deployer);
        console.log("ChainId:", block.chainid);
    }
}
