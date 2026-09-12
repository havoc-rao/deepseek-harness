# Agent Note: Session-independent right Sidebar surface

Status: implemented

English | [中文](2026-09-12-rightbar-session-independent-surface.zh.md)

## Problem

The right Sidebar's seat, its expand controls, and its tab bodies were strict `session` slots: no Session selected, no header, no button, no panel, and `ctx.sidebarRight` writes threw ("no session surface is mounted"). Keyboard shortcuts toggling the right panel (dsh-hotkey's `Cmd+Opt+B`) therefore did nothing in a session-less window. A new (blank) Session rendered the header with `display:none`, taking the expand button out of the DOM and breaking the same shortcut's DOM fallback in popup windows.

## Decision

The right Sidebar is session-maybe, with one reserved session-independent surface.

Every right-Sidebar seat that had `scope: 'session'` is now `scope: 'session-maybe'`: the panel seat `rightbar.session`, the tab body/title seats `sidebar.right.pane.tab` / `.title`, the menu seat `sidebar.right.tab.menu.item`, the guide chain `sidebar.right.tab.guide`, and the conversation header corner `conversation.session.header.corner`. They share one store handle, which the slot runtime allows because every seat is session-maybe. With a Session current the runtime mints one store instance per session and the seats behave exactly as before; with none they all resolve one reserved instance whose surface lives under the reserved key `'root'` (the same literal the renderer reserves for its own root store instance; host-minted Session ids never collide with it). The renderer's store axis resolves a session-maybe handle's absent binding to that reserved instance instead of throwing.

The seat binds the reserved key while no Session is current, so every `ctx.sidebarRight` command acts on the session-independent surface: `toggleExpanded`, `isExpanded`, `openTab`, `openResource`, `focus`, `split`, `float`, `dock` all work in a session-less window and throw only when no seat is mounted at all (a layout without the right column). Tab occurrences, navigation, and pins key under the reserved key exactly as under any session id; the session-independent surface keeps its state across sessions that come and go (the instance is cached for the handle's life).

Two expand affordances complete the contract. The hero mounts the same expand control in a new corner seat `conversation.hero.corner` (session-maybe; it renders itself away once a Session exists, since the session header's corner takes over), added to the Conversation shell's children. And the blank-session header no longer hides entirely: `ConversationSessionHeader` renders a corner-only band (title, utilities, and tabs stay hidden; the band collapses via CSS `:has()` when the corner renders nothing) so a new session's expand button survives. The tab-body seats are session-maybe so the session-independent panel can draw its tabs; a Session-bound tab type shows its own absent state there (the file tree's "no workspace") until a Session exists.

A declared store seat now always receives definite baked `actions` in its inject factory: the renderer always materializes an instance for a declared store, session-less included, so `InjectParams` no longer types them `| undefined`.

## Alternatives considered

**A parallel root-scoped dock.** A second full docking surface (`rightbar.global` with its own store and body seats) duplicates the panel machinery and forces every tab type to register its body twice; the shared-handle rule (one handle, one scope) forces a second store that cannot share state with the session seats. The session-maybe reseating keeps one handle, one panel, one set of bodies, and the reserved key maps all knowledge of "no session" to one place.

**Rendering the full session header while blank.** Showing the title row and tabs for a blank session gives the hero content that has nothing to say; the corner-only band keeps every existing blank-session behavior (settling, centered hero) and adds only the control that is actually reachable.

**Exposing an observable controller.** The hero corner could have read expansion through a new `ctx.sidebarRight` subscription. The shared store already is the observable; the corner reuses the same seat pattern as the header corner instead of widening the service face.

## Consequences

dsh-hotkey's right-panel toggle now works in session-less windows (`toggleExpanded` acts on the session-independent surface; `[data-sidebar-right-expand]` exists in the hero corner and in blank-session headers) and per-session behavior is unchanged. The slot contract documents seven seats as session-maybe; all in-repo registrants (ui-sidebar-files, ui-sidebar-documentpreview, ui-sidebar-right) type against maybe-standard props, so out-of-repo registrants into `sidebar.right.pane.tab` must treat `sessionId` as optional in the same change. The session-independent surface shows content only its tab types can provide without a Session; Session-bound types show their absent state, and the file tree has no workspace root to list until a Session exists. The renderer's session-maybe store resolution (absent binding -> reserved instance) generalizes the seat contract for any future session-maybe store seat.