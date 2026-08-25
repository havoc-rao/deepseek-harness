# Agent Note: Workspace logo as an installable dsh plugin bundle

Status: implemented

English | [中文](2026-08-24-workspace-logo-plugin-bundle.zh.md)

## Problem

The workspace logo feature — picker, durable host record, row/menu/hover-card
rendering — currently ships inside four core packages: the `logo` record field
in `dsh-workspace`'s zod schema, `workspace.setLogo` in `dsh-host-apiproxy`'s
static RPC tables, `setLogo` on the runtime `IWorkspaces` face, and inline
row/menu rendering in `dsh-client-ui-workspace`. `dsh plugin --profile <name>
add <package>` can only install patch-layer bundles made of rows; it cannot
add a record-schema field, an RpcMethodMap entry, or inline UI. The feature is
therefore not independently installable: every profile, headless included,
carries it whether or not the surface ever uses it.

The goal was an optional plugin: `dsh plugin --profile web add <bundle>`
mounts the feature; profiles without it show the plain folder glyph, issue no
logo RPC, and keep today's byte-for-byte behavior.

## Decision

Two core extension seams, one deliberately retained core fact, and one new
plugin package that is itself an installable bundle.

### Core seam — row-level slot holes in `dsh-client-ui-workspace`

The ui-workspace entry declares three new `single`-kind child holes, mirroring
the existing `directoryFlow` pattern ([slot system
standard](./2026-07-22-slot-type-chain-implementation.md)):

| Slot | Owner props | Mounted behavior |
| --- | --- | --- |
| `sidebar.workspaces.workspaceIcon` | `workspaceId, label, logo, expanded, containsCurrent` | The 16px leading cell of a real Workspace row: occupant renders the logo image; hole empty → the standing folder glyph renders (occupancy-based swap, the same mechanism the add-workspace affordance already uses) |
| `sidebar.workspaces.workspaceMenu` | `workspaceId, label, menuOpen` | Trailing ellipsis menu extension: occupant contributes the "Add logo image" entry (rename/delete stay core) |
| `sidebar.workspaces.workspaceHoverIcon` | `workspaceId, label, logo` | The hover-card header: occupant renders the card-sized logo; hole empty → title-only card |

All three are root-scope `single` holes. `WorkspaceLogoImage`, its
size/fallback rules, and the picker (`input[type=file]`, MIME/size caps,
data-URL read) moved unchanged into the occupant. The core keeps the file-free
folder fallback only. Menu dispatch stays core: an unknown id already returns
before the destructive branch.

### Retained core facts (deliberate)

- The durable `logo` field in the workspace record schema and entity
  `setLogo` stay in `dsh-workspace`: an optional, inert field. Plugin-less
  profiles never write it; zod strips unknown keys when older cores read
  newer registries (pre-release stance).
- `IWorkspaces.setLogo` and the `workspace.setLogo` RPC stay in core: the UI
  plugin is their only caller, and a dormant RPC is the smaller surface than
  an RPC-extension seam.

### Plugin package and bundle shape

`packages/experimental/workspace-logo/` (`@havocrao/dsh-client-workspace-logo`,
`dsh.client` platform `web`) fills the three holes; reads the logo from the
hole owner props; commits picks through its own inject face wrapping the core
`ctx.workspaces.setLogo`.

The client package declares the full `dsh.bundle` section itself
(`dsh.bundle.patch` → its own `cordis.patch.yml`, plus the row and package
dependency): it is the patch-layer bundle `dsh plugin --profile <name> add`
consumes, so no separate `packages/bundle/workspace-logo/` package exists.
Out-of-tree profiles mount it with `dsh plugin add
@havocrao/dsh-client-workspace-logo`; published under the author's personal
client package through `dsh-web-app`'s own patch row (`ui-workspace-logo`) and
`package.json` dependency.

Mount/unmount: `dsh plugin --profile web add <bundle>` / `disable
ui-workspace-logo`; a disabled row unloads the occupant and the holes fall
back to the folder glyph (hot-reload, same occupancy machinery as
directoryFlow). No session-format change, no model-visible change. A profile
without the bundle has no participating locale keys, issues no logo RPC, and
renders the folder glyph.

## Alternatives considered

- **Full split including RPC and domain seams**: maximum decoupling —
  `workspace.setLogo` + schemas move into the bundle and instance; cost is
  two new capability seams (plugin-declared RPC registry, extensible domain
  schema) with their Service Definition/Provider/Consumer trios, tests, and
  an Agent Note each. Deferred: the dormant-RPC surface is small, and the
  domain-schema seam is the largest architecture investment in the repo.
- **Separate `packages/bundle/workspace-logo/` package**: a patch layer
  distinct from the client package. Rejected as redundant: the client package
  already carries the `dsh.bundle.patch` declaration, so the bundle seam costs
  nothing extra and keeps one package to install, build, and release.
- **Feature flag over the existing rows** (`dsh plugin … disable` an
  in-core row): no independence — the feature still ships in core and
  out-of-tree installs get nothing new.
- **Client-only bundle without row holes**: no seat exists for row content;
  rejected — holes are the only sanctioned composition route.

## Consequences

- The three slot holes widen ui-workspace's declared-children contract; the
  seam pays for itself only while the logo remains plugin-shaped — an in-core
  feature could still render inline.
- HMR unload of the dynamic client row leaves the holes empty mid-session
  (directoryFlow occupancy already owns this machinery).
- The deferred `ctx.rpcMethods` seam is recorded debt, not surprise: if a
  later round wants the RPC plugin-owned too, that registry must be built
  first; RpcMethodMap stays static either way.
- Out-of-tree installs resolve through npm; in-box resolution follows the
  existing bundle mechanism.
- The assembled web surface carries the feature by default (the web-app patch
  row is part of the shipped profile), so today's behavior is preserved while
  the feature is independently removable.

## Testing

- Package tests: workspace-logo's apply/invariant/logo suites plus the
  ui-workspace rows/workspace-browser suites; typecheck, lint, build, and the
  `verify-client-packages` / `verify-cordis-config` gates pass.
- Assembled coverage: `apps/web/tests/workspace-management.e2e.ts` gained a
  logo scenario (menu entry → picker commit → durable registry record → row
  and hover-card image → logo surviving reload), zero model calls; the same
  file's stale session-card copy assertions were updated to the shipped card
  behavior (the copy affordance lives on the workspace card, pinned by the
  `home-path-tilde` snapshot).