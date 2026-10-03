// Package main — AISHA Cosmos App-Chain binary entrypoint.
//
// This is the main binary for the AISHA private app-chain.
// Built on Cosmos SDK v0.50.x with CometBFT consensus.
//
// Custom modules:
//   - x/tokenledger: Token mint/burn/transfer audit records
//   - x/auditlog: Immutable journal entries
//
// Standard modules included:
//   - x/auth, x/bank, x/staking, x/gov, x/mint, x/distribution
//   - x/slashing, x/crisis, x/params, x/evidence, x/feegrant, x/upgrade
//   - IBC (for future cross-chain, not active in Phase 1)
package main

import (
	"fmt"
	"os"

	svrcmd "github.com/cosmos/cosmos-sdk/server/cmd"

	"github.com/evymo/aisha-chain/app"
)

func main() {
	rootCmd := NewRootCmd()

	if err := svrcmd.Execute(rootCmd, "", app.DefaultNodeHome); err != nil {
		fmt.Fprintln(rootCmd.OutOrStderr(), err)
		os.Exit(1)
	}
}
