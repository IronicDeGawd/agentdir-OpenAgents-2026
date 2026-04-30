# Probe: KeeperHub

Validates KeeperHub primitives we use for x402 settlement of paid skill calls.

## What it checks

1. REST API reachable with `kh_` API key.
2. List workflows (verifies auth scope).
3. Create empty workflow → returns workflowId.
4. Execute workflow → executionId.
5. Poll execution status → reaches `success` or `error` (not stuck pending).
6. Delete the test workflow.

## Why these

- agentdir settles paid A2A calls via KeeperHub workflows or direct execution API.
- Need to know auth + lifecycle before wiring it into the agent runtime.

## Run

```bash
cd probes/keeperhub
KH_API_KEY=kh_... bash probe.sh
```

Get key: https://app.keeperhub.com → Settings → API Keys → Organisation tab.

## Pass criteria

All 6 checks PASS within 30s.

## Fail modes → what it tells us

- 401 → wrong key prefix (`wfb_` is webhook-only); use `kh_`.
- Workflow create returns 422 with "no integration" → wallet integration must exist first; create one in UI.
- Execution stuck pending → likely missing wallet funding; switch to read-only execute test.
