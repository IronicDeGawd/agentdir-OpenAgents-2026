#!/usr/bin/env bash
# Phase-0 probe: Uniswap Trading API quote.
set -u

API="https://trade-api.gateway.uniswap.org/v1"
KEY="${UNISWAP_API_KEY:-}"

if [ -z "$KEY" ]; then
  echo "UNISWAP_API_KEY missing"; exit 2
fi

PASS=0; FAIL=0

# WETH→USDC mainnet, 0.001 ETH in
BODY=$(cat <<'EOF'
{
  "swapper": "0x0000000000000000000000000000000000000001",
  "tokenIn": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "tokenOut": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "tokenInChainId": "1",
  "tokenOutChainId": "1",
  "amount": "1000000000000000",
  "type": "EXACT_INPUT",
  "slippageTolerance": 0.5,
  "routingPreference": "CLASSIC"
}
EOF
)

CODE=$(curl -s -o /tmp/uni-out -w '%{http_code}' -X POST "$API/quote" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -H "x-universal-router-version: 2.0" \
  -d "$BODY")

if [[ "$CODE" =~ ^2 ]]; then
  echo "PASS  quote ($CODE)"; PASS=$((PASS+1))
  ROUTING=$(python3 -c "import sys,json;print(json.load(sys.stdin).get('routing',''))" </tmp/uni-out 2>/dev/null || echo "")
  if [ -n "$ROUTING" ]; then
    echo "PASS  quote.routing=$ROUTING"; PASS=$((PASS+1))
  else
    echo "FAIL  quote missing 'routing' field"; FAIL=$((FAIL+1))
  fi
else
  echo "FAIL  quote ($CODE) — $(head -c 300 /tmp/uni-out)"; FAIL=$((FAIL+1))
fi

echo ""
echo "$PASS passed, $FAIL failed"
exit $((FAIL == 0 ? 0 : 1))
