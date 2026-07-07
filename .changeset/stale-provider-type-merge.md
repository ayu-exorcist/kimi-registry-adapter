---
'@kastral/kra': patch
---

Fix registry updates so provider-level fields like `type` and `api` are merged back into `api.json` during refresh instead of staying stale.
