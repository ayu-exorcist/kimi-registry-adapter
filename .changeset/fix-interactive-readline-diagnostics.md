---
'@kastral/kra': patch
---

Add opt-in structured diagnostics logging and stabilize interactive prompt input handling.

The CLI now keeps a shared readline keypress lifecycle across prompt transitions, preventing intermittent Windows/PowerShell menu freezes caused by repeated readline create/close cycles. Diagnostics can be enabled with `KRA_LOG=1` or `KRA_DEBUG=1` and are written to the KRA state directory by default.
