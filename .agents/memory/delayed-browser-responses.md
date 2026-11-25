---
name: Delayed browser responses
description: Synchronization for Puppeteer tests that deliberately hold intercepted responses.
---

When an async Puppeteer request interceptor waits on a manually released gate, signal request arrival inside that interceptor instead of awaiting a later `waitForRequest` listener.

**Why:** Puppeteer queues request interception listeners; a later listener can remain blocked behind the gate, deadlocking a test that waits for arrival before releasing the response.

**How to apply:** Use a separate arrival promise resolved before awaiting the gate. Always release the response in `finally`, and keep all writes intercepted even when assertions fail.
