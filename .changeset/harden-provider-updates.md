---
'@kastral/kra': patch
---

Fix provider updates that could persist invalid merge conflicts, wait on response bodies without a timeout, or ignore cancellation in interactive loading states. Provider discovery now validates local state before network work, fetches models and metadata concurrently, reuses the default metadata cache across CLI runs, and keeps the busy warning below the active spinner.
