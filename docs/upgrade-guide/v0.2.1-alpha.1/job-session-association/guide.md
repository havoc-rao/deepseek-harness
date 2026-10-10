---
kind: upgrade-guide
description: "Custom background-job providers must implement confirmed Session association on JobHandle and publish association changes."
---

# Background-job Session association

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-jobs` adds the required `JobHandle.setSession(sessionId)` method and the `session` member of `JobEvent`. External providers and test doubles that construct `JobHandle` must implement the method. Exhaustive event consumers must handle the new event. `JobView.sessionId` and `description` are optional; existing producers need no change unless they expose a target Session.

## Migration

1. Implement `setSession` in custom job providers: stage calls made inside `JobSpec.run`, publish the association after registration, emit a `session` event for live changes, retain the last association after settlement, and ignore subsequent writes with a warning.
2. Update exhaustive `JobEvent` handlers to process `session` as a lifecycle projection update. The association does not change owner authorization.
3. Publish only a confirmed, navigable Host `SessionId`; do not publish preallocated identities or external run IDs. `JobSpec.description` supplies optional one-line context. The Web job list uses the confirmed association for its independent navigation action.
4. Compile the provider and verify that an association made while running appears in the roster and remains after completion. See the [job provider reference](../../../../packages/jobs/jobs/README.md).
