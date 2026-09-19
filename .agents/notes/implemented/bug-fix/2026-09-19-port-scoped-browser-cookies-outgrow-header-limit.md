# Agent Note: port-scoped browser-session cookies outgrow the server header limit and break Electron startup

Status: implemented

English | [中文](2026-09-19-port-scoped-browser-cookies-outgrow-header-limit.zh.md)

## Problem

An Electron launch landed on the boot page's "Failed to load plugins" with
`bundle script /plugins/??... failed to load` for the 62-package application
combo, while the web profile started fine. The failing URL answered 200 to a
plain curl against the same running host, ruled out the module-graph and
rebuild mechanisms, and reproduced in a fresh Electron instance. In-page
`fetch` of the same URL returned HTTP `431 Request Header Fields Too Large`;
CDP showed the request headers totaled 14 872+ bytes, of which the `Cookie`
header was 14 362 bytes of accumulated `dsh-auth-*` cookies.

Root cause: `BrowserAuth.authorizeIndex` mints a persistent 30-day cookie
whose name derives from the request authority, and `requestAuthority`
includes the port. The web launcher binds a fixed port (3080), so its cookie
name is stable and each launch overwrites it; Electron allocates a fresh
port per launch, so every launch added one more durable cookie for the same
host-only `127.0.0.1` domain. After enough launches the cumulative Cookie
header (plus the 2.8 KiB combo URL in the request target) crossed node:http's
default 16 KiB `maxHeaderSize`; the server answered 431, the browser reported
the script as failed to load, and the boot page showed the failure. The small
bootstrap/workspace combos stayed under the limit, which is why only the big
application combo failed.

## Decision

The deterministic cookie name now binds the normalized hostname only
(`cookieAuthority` strips the port); `BrowserAuth` mints and reads the same
host-only name on every port, so each launch overwrites the cookie instead of
accumulating one. The signed payload still binds hostname plus port, so a
cookie minted by another port is rejected by the authority check — the
cross-port hardening does not regress. The webserver's `createServer` now
passes `maxHeaderSize: 64 KiB`: while old port-scoped cookie names linger in
a browser, they keep being sent with every request (up to their 30-day
expiry), and the raised budget tolerates that residue without serving
unrelated oversized requests.

## Alternatives considered

Raising the header limit alone was rejected: it merely postpones the failure
by days while cookies keep accumulating per launch. Dropping the persistent
cookie (session-only) was rejected: a restarted browser tab against a running
web profile would lose its session and require pasting the printed token URL
again. Clearing cookies on token exchange was rejected: HTTP offers no
origin-wide single-response clear that cannot erase the just-minted cookie on
the same response.

## Consequences

Electron (and any fresh-port launcher) now sends one bounded, host-only
browser-session cookie per host, and old port-scoped names expire naturally
within 30 days while the raised header budget absorbs them. One behavioral
shift: simultaneous launchers on the same host (for example a web profile and
an Electron instance together) share one cookie name, so the later launch
overwrites the earlier one and the earlier page's next refresh re-enters the
token exchange — acceptable for the single-instance usage the profiles
assume. Verified by clearing the accumulated Electron cookies and launching
an unchanged build: the app booted to the full UI; the 6 browser-auth tests
(plus a new regression that different ports mint one name and cross-port
cookies stay unauthorized) and the full connection/webserver suites pass (168
tests), and a development build completes cleanly.