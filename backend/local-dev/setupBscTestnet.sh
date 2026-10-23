#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Blockchain Masterclass — Binance Smart Chain TESTNET setup
#
# Points the whole backend at the BSC testnet (chain id 97) by
# writing a `.env.local` override, without touching your real
# `.env`. The test USDT token can either be deployed here or be
# one you deployed yourself (then no forge deploy happens).
#
# The testnet RPC is public, so no API key is needed. Note that
# Binance's own seed endpoint (data-seed-prebsc-*) answers basic RPC
# calls but rejects every eth_getLogs request, which the payment
# monitor needs, so it is never used. The endpoint below served a
# recent eth_getLogs range on every attempt when it was chosen; if it
# starts throttling, the listener rotates to the other built-in testnet
# endpoints on its own.
#
# Usage:
#   bash local-dev/setupBscTestnet.sh [payerPrivateKey] [deployedUsdtAddress]
#   BSC_TESTNET_PAYER_PRIVATE_KEY=0x... bash local-dev/setupBscTestnet.sh
#   BSC_TESTNET_USDT_CONTRACT_ADDRESS=0x... bash local-dev/setupBscTestnet.sh
# ============================================================

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DEV_DIR="$BACKEND_DIR/local-dev"
ENV_LOCAL_FILE="$BACKEND_DIR/.env.local"
BSC_TESTNET_PAYER_KEY_FILE="$LOCAL_DEV_DIR/bsc-testnet-payer.key"

BSC_TESTNET_RPC_URL="${BSC_TESTNET_RPC_URL:-https://bnb-testnet.api.onfinality.io/public}"
BSC_TESTNET_CHAIN_ID="${BSC_TESTNET_CHAIN_ID:-97}"
BSC_TESTNET_FAUCET_URL="https://www.bnbchain.org/faucet"
# When set, this mock USDT contract is used as-is instead of deploying a new one.
PRE_DEPLOYED_USDT_CONTRACT_ADDRESS="${2:-${BSC_TESTNET_USDT_CONTRACT_ADDRESS:-}}"
# publicnode refuses eth_getLogs over 50 000 blocks, so the monitor is told to
# chunk its scans and to only look back this far on a brand new deposit address.
MONITOR_LOG_SCAN_CHUNK_BLOCKS="${MONITOR_LOG_SCAN_CHUNK_BLOCKS:-10000}"
MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS="${MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS:-20000}"

if [ -z "$PRE_DEPLOYED_USDT_CONTRACT_ADDRESS" ] && ! command -v forge >/dev/null 2>&1; then
  echo "ERROR: forge (Foundry) is required to deploy the test USDT token. Install it from https://book.getfoundry.sh"
  echo "       Or pass an already deployed token: bash local-dev/setupBscTestnet.sh <payerKey> <usdtAddress>"
  exit 1
fi

if ! curl -s --max-time 10 "$BSC_TESTNET_RPC_URL" >/dev/null 2>&1; then
  echo "ERROR: BSC testnet RPC $BSC_TESTNET_RPC_URL is not reachable"
  exit 1
fi

REPORTED_CHAIN_ID=$(curl -s --max-time 15 -X POST "$BSC_TESTNET_RPC_URL" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  | grep -oE '"result":"0x[0-9a-fA-F]+"' | grep -oE '0x[0-9a-fA-F]+' | head -1)
REPORTED_CHAIN_ID_DECIMAL=$((REPORTED_CHAIN_ID))
if [ "$REPORTED_CHAIN_ID_DECIMAL" != "$BSC_TESTNET_CHAIN_ID" ]; then
  echo "ERROR: $BSC_TESTNET_RPC_URL reports chain id $REPORTED_CHAIN_ID_DECIMAL, expected the BSC testnet chain id $BSC_TESTNET_CHAIN_ID"
  exit 1
fi
echo "Connected to BSC testnet (chain id $REPORTED_CHAIN_ID_DECIMAL) at $BSC_TESTNET_RPC_URL"

# Payer key resolution order: argument, environment, saved key file, generated.
# The key never funds real money (testnet BNB only) but it is still a key, so it
# is kept out of version control.
BSC_TESTNET_PAYER_PRIVATE_KEY="${1:-${BSC_TESTNET_PAYER_PRIVATE_KEY:-}}"
if [ -z "$BSC_TESTNET_PAYER_PRIVATE_KEY" ] && [ -f "$BSC_TESTNET_PAYER_KEY_FILE" ]; then
  BSC_TESTNET_PAYER_PRIVATE_KEY="$(tr -d '[:space:]' < "$BSC_TESTNET_PAYER_KEY_FILE")"
fi
if [ -z "$BSC_TESTNET_PAYER_PRIVATE_KEY" ]; then
  BSC_TESTNET_PAYER_PRIVATE_KEY=$(node -e "import('ethers').then(({ Wallet }) => process.stdout.write(Wallet.createRandom().privateKey))")
  printf '%s' "$BSC_TESTNET_PAYER_PRIVATE_KEY" > "$BSC_TESTNET_PAYER_KEY_FILE"
  chmod 600 "$BSC_TESTNET_PAYER_KEY_FILE"
  echo "Generated a new testnet payer key and saved it to $BSC_TESTNET_PAYER_KEY_FILE"
fi

BSC_TESTNET_PAYER_ADDRESS=$(cast wallet address --private-key "$BSC_TESTNET_PAYER_PRIVATE_KEY")
BSC_TESTNET_PAYER_BALANCE_WEI=$(cast balance "$BSC_TESTNET_PAYER_ADDRESS" --rpc-url "$BSC_TESTNET_RPC_URL")
echo "Payer $BSC_TESTNET_PAYER_ADDRESS holds $(cast from-wei "$BSC_TESTNET_PAYER_BALANCE_WEI" ether) testnet BNB"

if [ "$BSC_TESTNET_PAYER_BALANCE_WEI" = "0" ] && [ -n "$PRE_DEPLOYED_USDT_CONTRACT_ADDRESS" ]; then
  echo ""
  echo "NOTE: payer $BSC_TESTNET_PAYER_ADDRESS has no testnet BNB."
  echo "      That is fine when you mint and send the token yourself; the"
  echo "      backend still needs it for gas when it sweeps a confirmed deposit:"
  echo "        $BSC_TESTNET_FAUCET_URL"
elif [ "$BSC_TESTNET_PAYER_BALANCE_WEI" = "0" ]; then
  echo ""
  echo "ERROR: payer $BSC_TESTNET_PAYER_ADDRESS has no testnet BNB, so it cannot deploy or pay gas."
  echo "Fund it with the Binance testnet faucet, then run this script again:"
  echo "  $BSC_TESTNET_FAUCET_URL"
  exit 1
fi

if [ -n "$PRE_DEPLOYED_USDT_CONTRACT_ADDRESS" ]; then
  PRE_DEPLOYED_USDT_CODE=$(cast code "$PRE_DEPLOYED_USDT_CONTRACT_ADDRESS" --rpc-url "$BSC_TESTNET_RPC_URL")
  if [ "$PRE_DEPLOYED_USDT_CODE" = "0x" ]; then
    echo "ERROR: $PRE_DEPLOYED_USDT_CONTRACT_ADDRESS has no contract code on the BSC testnet."
    echo "       Check the address, or omit it to deploy a fresh Mock USDT."
    exit 1
  fi
  USDT_CONTRACT_ADDRESS="$PRE_DEPLOYED_USDT_CONTRACT_ADDRESS"
  echo "Using the Mock USDT you already deployed at $USDT_CONTRACT_ADDRESS"
else
  echo "Deploying Mock USDT to BSC testnet..."
  DEPLOY_OUTPUT=$(forge create "$LOCAL_DEV_DIR/MockUsdt.sol:MockUsdt" \
    --rpc-url "$BSC_TESTNET_RPC_URL" \
    --private-key "$BSC_TESTNET_PAYER_PRIVATE_KEY" --broadcast --json 2>&1)
  USDT_CONTRACT_ADDRESS=$(printf '%s' "$DEPLOY_OUTPUT" | grep -oE '"deployedTo"\s*:\s*"0x[a-fA-F0-9]{40}"' | grep -oE '0x[a-fA-F0-9]{40}' | head -1)
  if [ -z "$USDT_CONTRACT_ADDRESS" ]; then
    echo "ERROR: failed to deploy Mock USDT to BSC testnet:"
    printf '%s\n' "$DEPLOY_OUTPUT"
    exit 1
  fi
  echo "Mock USDT deployed at $USDT_CONTRACT_ADDRESS"
fi

cat > "$ENV_LOCAL_FILE" <<EOF
# Auto-generated by local-dev/setupBscTestnet.sh — overrides .env for testnet testing only.
# Delete this file to return to the real network configuration.
BSC_RPC_URL=$BSC_TESTNET_RPC_URL
ALCHEMY_RPC_URL=$BSC_TESTNET_RPC_URL
CHAIN_ID=97
# Extra public testnet endpoints for the listener to rotate onto. A public node
# throttles per IP and this one polls every few seconds, so a rate-limited
# endpoint is parked for a cool-down and the next one is used instead.
BSC_RPC_URL_FALLBACK_URLS=https://bsc-testnet.publicnode.com,https://bsc-testnet-rpc.publicnode.com
# The listener needs no provider-specific indexing API: transfers are read with
# eth_getLogs and settled against the "finalized" block tag.
SETTLEMENT_FINALITY_MODE=finalized
MONITOR_LOG_SCAN_CHUNK_BLOCKS=$MONITOR_LOG_SCAN_CHUNK_BLOCKS
MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS=$MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS
USDT_CONTRACT_ADDRESS=$USDT_CONTRACT_ADDRESS
USDT_MIN_CONFIRMATIONS=1
# Testnet-only payer: holds the testnet BNB for gas and mints the test USDT.
BSC_TESTNET_PAYER_PRIVATE_KEY=$BSC_TESTNET_PAYER_PRIVATE_KEY
GAS_WALLET_PRIVATE_KEY=$BSC_TESTNET_PAYER_PRIVATE_KEY
TREASURY_WALLET_ADDRESS=$BSC_TESTNET_PAYER_ADDRESS
USDT_RECEIVING_WALLET=$BSC_TESTNET_PAYER_ADDRESS

# Background jobs: poll fast so a testnet payment is noticed within seconds.
ENABLE_JOBS=true
ENABLE_PAYMENT_MONITOR_JOB=true
ENABLE_SWEEP_JOB=true
ENABLE_ORDER_EXPIRY_JOB=true
MONITOR_POLL_INTERVAL_MS=5000
# Collection is a daily, deliberate job, never immediate.
SWEEP_INTERVAL_HOURS=24
SWEEP_MINIMUM_AGE_HOURS=24
SWEEP_POLL_INTERVAL_MS=3600000
ENABLE_TICKET_DELIVERY_RETRY_JOB=true
TICKET_DELIVERY_RETRY_INTERVAL_MS=60000
EOF

echo ""
echo "Wrote $ENV_LOCAL_FILE"
echo "Backend now points at BSC testnet. Start it with: npm run dev"
echo "Pay a booking's deposit address with: npm run testnet:pay -- <depositAddress>"
