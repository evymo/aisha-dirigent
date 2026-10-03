#!/usr/bin/env node
import { buildRpcInventory } from "./lib/rpc-inventory.mjs";

const inventory = buildRpcInventory();
process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
