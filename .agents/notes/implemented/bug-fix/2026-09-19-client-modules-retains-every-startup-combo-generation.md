# Agent Note: client-modules retains every content-addressed startup combo generation

Status: implemented

English | [中文](2026-09-19-client-modules-retains-every-startup-combo-generation.zh.md)

## Problem

A dev harness boot could land on the boot page's "Failed to load plugins" with
`failed to import loader entry <hash> (<package>): client-modules: bundle
script /plugins/??... failed to load`. The combo URL (a 62-entry application
batch, rev `20c29c168dfd`) answered 404 while the bootstrap combo still loaded,
so every application entry failed activation. Missing bundles were not the
cause: the same page's graph carried that exact URL, and a fresh host-process
boot served it 200 — the URL only 404s after recomposition.

`ClientModuleRegistry` retained only one prior graph generation of batch
responses (`previousBatchResponses`): every `rebuilt()` recomposition replaces
the startup batch URLs (they hash the combined bundle bytes), moves the current
generation into the one-generation buffer, and drops whatever was there
before. A dev rebuild storm breaks the one-generation guarantee: one tsdown
pass rewriting many client bundles recomposes the graph once per changed
package (HMR polls every row on a 500 ms interval), so the second rebuild
already evicts the first generation. An index page rendered before the storm —
or a window that opens while it runs — then requests a combo URL this host
process no longer serves, and every application entry fails activation.

## Decision

Content-addressed startup combo responses are accumulated by URL for the host
process lifetime (`retainedBatchResponses`): a combo URL is immutable
(`cache-control: immutable`) and is referenced by index pages that can predate
several dev rebuild generations, so an early URL must stay answerable for the
whole process. Repeated recompositions produce stable URLs when bundle bytes
are unchanged (hashing is content-addressed), so the map grows only with
distinct content generations, not with rebuild count. The one-generation
`previousBatchResponses` field is deleted; unknown or altered resource lists,
missing revisions, and stale single-resource (`invalidate`) revisions still
answer 404 — only startup combo URLs become permanently answerable.

## Alternatives considered

Retaining a bounded ring of recent generations (for example the last eight)
was rejected: a tsdown pass rewriting many packages recomposes the graph once
per changed package, which can exceed any small ring within one build storm,
and sizing the ring for the full storm multiplies memory without a principled
bound — the content-addressed accumulation instead grows only with distinct
content generations and never evicts a URL an index page can still reference.

## Consequences

A host process keeps every startup combo generation it ever served, so an
index page from any point in the current process's rebuild history boots
successfully; memory grows with distinct content generations (the package
README's snapshot-delivery limitation now states this explicitly). The
trade-off costs a little retained memory during long dev sessions and keeps
serving combo URLs for bundle content no longer on disk. Desktop and web hosts
share the same registry, so both benefit. A host process restart still cannot
answer URLs from a previous process — the HMR `hostInstance` frame tells stale
tabs to refresh, unchanged. Package suite: 84 passed (41 node-half + 43
loader); `tsc -b` clean. No session-log, snapshot, or SDK surface touched.