#!/usr/bin/env bash
# Phase-0 probe: KeeperHub REST API smoke.
set -u

API="${KH_API_BASE:-https://app.keeperhub.com/api}"
KEY="${KH_API_KEY:-}"
PASS=0; FAIL=0

if [ -z "$KEY" ]; then
  echo "KH_API_KEY missing"; exit 2
fi

H=( -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" )

call() {
  local name="$1"; local method="$2"; local path="$3"; local body="${4:-}"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/kh-out -w '%{http_code}' -X "$method" "${H[@]}" -d "$body" "$API$path")
  else
    code=$(curl -s -o /tmp/kh-out -w '%{http_code}' -X "$method" "${H[@]}" "$API$path")
  fi
  if [[ "$code" =~ ^2 ]]; then
    echo "PASS  $name ($code)"; PASS=$((PASS+1))
  else
    echo "FAIL  $name ($code) — $(head -c 200 /tmp/kh-out)"; FAIL=$((FAIL+1))
  fi
}

# 1. Auth + list workflows
call "list workflows" GET "/workflows"

# 2. Create minimal workflow: manual trigger node only.
WF_BODY=$(cat <<'JSON'
{
  "name": "agentdir-probe",
  "description": "smoke",
  "nodes": [
    {
      "id": "trigger-1",
      "type": "trigger",
      "position": { "x": 100, "y": 100 },
      "data": {
        "label": "Manual Trigger",
        "type": "trigger",
        "config": { "triggerType": "Manual" },
        "status": "idle"
      }
    }
  ],
  "edges": []
}
JSON
)
RESP=$(curl -s -X POST "${H[@]}" -d "$WF_BODY" "$API/workflows/create")
WID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$WID" ]; then
  echo "PASS  create workflow ($WID)"; PASS=$((PASS+1))
else
  echo "FAIL  create workflow — $RESP"; FAIL=$((FAIL+1))
fi

# 3. Execute (manual trigger)
if [ -n "$WID" ]; then
  EXEC=$(curl -s -X POST "${H[@]}" "$API/workflow/$WID/execute")
  EID=$(echo "$EXEC" | python3 -c "import sys,json;print(json.load(sys.stdin).get('executionId',''))" 2>/dev/null || echo "")
  if [ -n "$EID" ]; then
    echo "PASS  execute workflow ($EID)"; PASS=$((PASS+1))
  else
    echo "FAIL  execute workflow — $EXEC"; FAIL=$((FAIL+1))
  fi

  # 4. Poll status (up to 20s)
  if [ -n "$EID" ]; then
    STATUS=""
    for _ in $(seq 1 10); do
      STATUS=$(curl -s "${H[@]}" "$API/workflows/executions/$EID/status" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
      [[ "$STATUS" == "success" || "$STATUS" == "error" || "$STATUS" == "cancelled" ]] && break
      sleep 2
    done
    if [[ "$STATUS" == "success" || "$STATUS" == "error" ]]; then
      echo "PASS  status reached terminal ($STATUS)"; PASS=$((PASS+1))
    else
      echo "FAIL  status stuck ($STATUS)"; FAIL=$((FAIL+1))
    fi
  fi

  # 5. Delete
  call "delete workflow" DELETE "/workflows/$WID?force=true"
fi

echo ""
echo "$PASS passed, $FAIL failed"
exit $((FAIL == 0 ? 0 : 1))
