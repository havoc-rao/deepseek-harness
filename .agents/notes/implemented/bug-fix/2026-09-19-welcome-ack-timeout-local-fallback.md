# Agent Note: Welcome-notice acknowledgement falls back locally when the Host write hangs

Status: implemented

English | [中文](2026-09-19-welcome-ack-timeout-local-fallback.zh.md)

## Symptom

An empty-session (welcome) page in the Web GUI could strand the Internal
Testing Notice permanently: clicking Continue left the acknowledgement write
pending in the settings transport, the store stayed `saving`, the button was
disabled forever, and the full-viewport modal mask blocked every interaction
behind it. Reproduced with a hung (never-settling) `remote.settings.mutate`:
`acknowledge()` awaited `scope.set` without a budget, so a write that neither
settled nor rejected never released the notice. The mask is modal by design;
the defect was that the notice could not be closed at all.

## Decision

`WelcomeNoticeStore.acknowledge()` races the Host write against a wall-clock
budget (`WELCOME_ACK_WRITE_TIMEOUT_MS`, 5 s default; injectable for tests).
A timeout is treated as persistence-unavailable: the acknowledgement advances
in-process and is mirrored to `localStorage`
(`WELCOME_ACK_LOCAL_KEY` = `dsh.welcomeNotice.version`, compared for exact
version equality like the Host field), so a refresh does not re-show the
notice. An explicit Host rejection keeps the existing error path (the write
was refused, not hung — those are different user-visible semantics and the
rejection must not be papered over). `derive()` folds the local fallback into
both the `ready` and `unavailable` branches, so a browser that already
acknowledged locally never blocks on namespace availability again.

The scope remains the single durable transport when it answers; the local
fallback only ever fills a bucket the Host left hanging. A late Host write
settling after the timeout flips the derived ack to true from the Host source
without contradicting the local one.

## Facts

Identified through a headless-browser reproduction of the modal-mask
interaction loss; the transport hang was isolated to `scope.set` never
settling under an empty session, and unit-tested with a hung fake `mutate`.
Coverage added: hung-write timeout → local ack + storage persisted; local ack
read when the namespace is unavailable; local-write failure still
acknowledges in memory. Package suite: 240 passed. No session-log, snapshot,
or SDK surface touched; the change is GUI state handling only.