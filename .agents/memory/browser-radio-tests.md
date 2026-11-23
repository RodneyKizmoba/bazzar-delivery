---
name: Browser radio tests
description: Avoid timing-dependent assertions when testing Radix radio keyboard navigation.
---

In browser tests of Radix radio groups, wait for the expected focus and selection before inspecting tab order or sending another key.

**Why:** Roving focus can move asynchronously after an arrow key; immediate assertions passed on desktop but failed intermittently at mobile width.

**How to apply:** Wait for the expected radio to be both focused and checked instead of adding fixed delays.
