# Agent Note: OpenCode Go session header

Status: implemented

English | [中文](2026-09-12-opencode-go-session-header.zh.md)

## Problem

OpenCode's Console Go and Zen gateways began requiring the `x-opencode-session` request header on 2026-09-05 and answer HTTP 400 `MissingSessionID` without it ([discussion #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495), [pi#9326](https://github.com/earendil-works/pi/issues/9326)). `@earendil-works/pi-ai` 0.85.1 sends no such header, and upstream's fix has not shipped a release, so every harness request on an `opencode` or `opencode-go` route failed before inference. The harness already passes a stable per-conversation `sessionId` to pi-ai, and the direct DeepSeek adapter already sends [its own conversation header](../feature/2026-08-11-deepseek-request-user-id-header.md), but the pi-ai adapter forwarded nothing.

## Decision

`dsh-llm-pi-ai` attaches `x-opencode-session` to requests that reach the OpenCode gateway, identified by the catalog provider ids `opencode` and `opencode-go` or by a model endpoint on `opencode.ai` including its subdomains. The value is `GenerateOptions.sessionId`; a request naming no session sends a fresh UUID so it still routes. A deployment-configured `headers` entry of the same name wins, because profile headers are deployment-owned. Detection and header construction live in `src/opencode-session.ts`, and the adapter merges the result beneath the attribution headers it already sends. No provider-neutral API, Session event, or configuration field changed.

## Alternatives considered

**Wait for the pi-ai release.** Upstream fixed the library on `main` for the next release, but no published version carries the fix, so an OpenCode route stays broken until one does.

**A per-route `sessionHeader` config field.** An explicit field would let any gateway name its own header, but it leaves the known gateway broken until every deployment opts in, and the gateway's requirement is a fixed external protocol fact rather than a deployment choice.

**One static header value for the whole deployment.** The existing `headers` field already spells that, and it restores routing while collapsing every conversation onto one affinity key, which defeats the gateway's prompt-cache routing.

## Consequences

OpenCode gateway requests carry the affinity id OpenCode requires; every other route is untouched. [`tests/opencode-session.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/opencode-session.spec.ts) covers provider-id and host matching, subdomains, the no-session fallback, the deployment override, and an unparseable endpoint against the installed catalog. [`tests/adapter.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) asserts the header on the wire for one OpenCode route and its absence on another. The gateway host and provider ids are fixed constants; a pi-ai catalog rename that keeps the `opencode.ai` endpoint stays matched by host, while a new gateway host or provider id needs one edit here.
