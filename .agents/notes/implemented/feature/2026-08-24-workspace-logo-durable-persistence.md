# Agent Note: Workspace logo durable persistence

Status: implemented

English | [中文](2026-08-24-workspace-logo-durable-persistence.zh.md)

## Problem

Each Workspace can carry one logo image replacing the folder glyph in the
browser tree. The first implementation kept the picked image in the browser
only (component state, then the viewing store's localStorage): a `dsh web`
stop/start — or any origin change — cleared it, so the logo never traveled
with the Workspace's durable data. The Host workspace record had no logo
field, and the workspace row UI consumed only `WorkspaceView` projections.

## Decision

The logo is durable workspace data owned by the Host:

- `dsh-workspace` records an optional `logo` data URL in the workspace record
  (zod `.optional()`, read-boundary validation like every record field) and
  the entity exposes `logo`/`setLogo(logo: string | undefined)`.
- The entity enforces the data-URL length cap at the durable write boundary:
  the domain write path does not re-validate records, so an oversized write
  would corrupt the next registry open.
- The wire grows `workspace.setLogo(workspaceId, logo: string | null)` —
  null clears the logo — plus `WorkspaceView.logo`. Two identical
  `LOGO_IMAGE_DATA_URL_MAX_LENGTH` constants live in dsh-workspace's spec and
  in the api/ layer (api/ stays zero host dependencies); the rpc-schemas
  suite pins them equal.
- The browser reads `group.logo` (derived from `WorkspaceView.logo` in
  `tree.ts`) and commits picks through the injected `setWorkspaceLogo`
  action (`ctx.workspaces.setLogo`); the row keeps its picker, menu entry,
  and folder-glyph fallback unchanged. The earlier browser-local storage
  (component state, then viewing-store `workspaceLogos` at persist key v6)
  was reverted; the viewing store returned to its pre-logo shape and key.

The registry domain version stays 2: the field is strictly additive, old
records parse, and zod strips unknown keys when older code opens newer data.

## Alternatives considered

- Browser localStorage store (the earlier attempt): origin-bound, silently
  lost on `dsh web` restarts, and content in a viewing-state store. Rejected
  by the observed failure this note fixes.
- Logo file inside the workspace directory plus a webserver asset route:
  natural home for the bytes, but requires new static serving, caching, and
  invalidation machinery for a 16px avatar; the record data URL is the
  smaller surface.

## Consequences

- The logo persists across web stop/start, follows the Workspace through the
  registry, and is pruned with it on delete.
- Registry JSON grows by up to ~2.8 MB of base64 per logo; a Workspace with
  many large logos inflates the registry file and every write, bounded by
  the cap and by the picker's 2 MiB image-byte limit — no downscaling yet.
- The logo is host content, never model-visible: no session-log event, no
  `SESSION_FORMAT_VERSION` change.
- Client-side picking remains untested against the assembled web snapshot
  suite; unit coverage pins each layer (entity durability, RPC + schema,
  manager echo, row rendering).