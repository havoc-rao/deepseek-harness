# @havocrao/dsh-client-workspace-logo

English | [中文](README.zh.md)

Workspace logo surface plugin: fills [dsh-client-ui-workspace](../ui-workspace/README.md)'s three workspace-row holes — the leading 16px cell (`sidebar.workspaces.workspaceIcon`), the ellipsis-menu footer (`sidebar.workspaces.workspaceMenu`), and the hover-card header (`sidebar.workspaces.workspaceHoverIcon`) — with the workspace logo image, the image picker, and the durable Host commit.

The logo itself is workspace data owned by the Host: the `logo` data URL lives in the workspace record, is served through `WorkspaceView.logo`, and is replaced or cleared through the core `workspace.setLogo` RPC (null clears; the wire and durable caps are pinned equal by the apiproxy schema suite). This package contributes only the surface: the row cell renders the host logo with the folder glyph as the no-logo / loading / failure fallback, the menu footer entry opens the image picker (image MIME and a 2 MiB byte cap are enforced before the data URL is read), and the hover card shows a card-sized logo beside the title. Picks commit through the inject face wrapping `ctx.workspaces.setLogo`; failures are non-fatal console diagnostics and the returned view redraws the row.

Mounting this package composes the whole surface from one cordis.yml row: install it with `dsh plugin --profile <name> add @havocrao/dsh-client-workspace-logo` (or a tarball/path spec), and `dsh plugin --profile <name> disable ui-workspace-logo` unmounts it, returning the rows to the plain folder glyph and title-only cards without a restart.

The node half is an empty `apply`: it exists so the plugin appears in the host cordis.yml and Loader, while the browser half ships through `exports["./client"]` and is discovered through the `dsh.client` manifest declaration.

## Installation

In-box web profiles already mount the surface (the dsh-web-app patch row `ui-workspace-logo`); turn it off with `dsh plugin --profile web disable ui-workspace-logo` and back on with `enable`, no server restart needed for the browser half.

Published npm channel (any profile):

```
dsh plugin --profile web add @havocrao/dsh-client-workspace-logo
```

Source or tarball channels install the package into the profile the same way any dependency does (a tarball/path spec reconciles to the package's real name and joins the profile bundle stack when the manifest carries `dsh.bundle.patch`). After any client-side change, hard-refresh the browser (Cmd/Ctrl+Shift+R); the host half is an empty placeholder, so no DSH restart is needed for this package alone. pnpm 11 blocks install scripts by default — if a future build script is rejected, approve it in the profile directory (`pnpm approve-builds`).

## Model Experience

None, as the workspace logo surface is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No downscaling** — the picker caps image bytes at 2 MiB but stores the full-size data URL; a canvas downscale pass is deferred, so registry files grow with large logos up to the cap.
- **No clear affordance in the surface** — clearing requires the wire `workspace.setLogo(workspaceId, null)`; a future menu entry could expose it.
