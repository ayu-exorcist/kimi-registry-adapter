---
'@kastral/kra': patch
---

Prevent interactive menus from freezing when a terminal sends an incomplete or unsupported dynamic theme response. Prompt input, including Ctrl+C, now recovers after a bounded timeout while valid split theme responses continue to work.
