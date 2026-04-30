// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentdirINFT} from "../src/AgentdirINFT.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        AgentdirINFT inft = new AgentdirINFT(deployer);
        vm.stopBroadcast();
        console.log("AgentdirINFT deployed at:", address(inft));
        console.log("Owner:", deployer);
    }
}
