# Agent Note: ModelSelect trigger aria-label supplies the provider; stale committed tests typecheck

Status: implemented

English | [中文](2026-09-19-model-select-trigger-aria-provider-and-stale-test-typecheck.zh.md)

## Problem

A dev build surfaced two pre-existing defects on the model-seat branch state:

1. `trigger.aria` / `trigger.ariaEffort` templates carry a `{provider}`
   placeholder, but `ModelSelect`'s aria composition never passed a provider
   argument, so the accessible name rendered the literal text `{provider}`
   (for example `选择模型，当前 DeepSeek-V4-Flash · {provider}，推理等级 High`).
   The unit spec and the web e2e (`apps/web/tests/declared-reasoning.e2e.ts`)
   both expect the provider display name, so the rendering was the defect.
2. Three committed test files — `ui-layout/tests/panel-preference.client.spec.ts`,
   `ui-layout/tests/right-panel-width-row.client.spec.tsx`, and
   `ui-model-selection/tests/model-select.client.spec.tsx` — never passed `tsc`:
   a function exported with `import type` used as a type (TS6133/TS2749), an
   implicit-any arrow parameter (TS7006), and `ModelSelect` mocks missing the
   `SessionProvider` prop the session-scoped label slot derives
   (TS2741) plus untyped `renderSlot` owner access against the
   never-instantiated generic key (TS2339). Together they blocked
   `NODE_ENV=development pnpm run build` at the `tsc` stage.

## Decision

`ModelSelect` composes the aria label with the provider display name
(`currentChoice?.group.name` when the catalog route resolves, the provider id
otherwise), matching the locale template and the e2e expectation. Two unit
expectations that predated the template's provider segment were updated
(durable-model-id and loading-resolved cases now assert the full
`model · provider` aria); the unoccupied-label case asserts the model label
and the effort segment separately, because the provider route renders only
through a label occupant (covered by the label-slot cases). The three test
files were brought to type: `typeof createLayoutStore` for the store factory,
an explicit parameter annotation for the `t` stub arrow, a
`SessionProvider` stub (the component never renders it) passed to every
`ModelSelect` render, and `renderSlot` assertions that exercise the owner via
`toEqual` without touching its never-instantiated generic properties.

## Alternatives considered

Dropping the `{provider}` placeholder from the templates was rejected: the
e2e expectation and the label-slot owner contract both call for the provider
display name in the accessible route, so the templates were the specification
and the aria composition the missing piece. Casting the mocked seat props
around the missing `SessionProvider` was rejected: the slot declaration
derives the prop from its session scope, so the renders supply the stub like
any other framework seat.

## Consequences

The accessible name of the composer model trigger now announces the provider
route as specified (fixing the e2e's currently-matching expectation), and the
three stale test files compile and pass, so a development build no longer
reds at `tsc`. Verified: `NODE_ENV=development pnpm run build` exit 0 (240
client artifacts, code-finder locator instrumentation present), the
client-modules / ui-layout / ui-model-selection suites green (238 tests),
`oxlint` clean on every touched file. No session-log, snapshot, or SDK
surface changed; no locale text changed, only the aria composition and test
expectations.