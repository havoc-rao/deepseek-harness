# Sent message
- text: Sent External project and
- button "notes.md"
- text: {{clock}}
- button "Copy"
# Queued message
- list:
  - listitem:
    - text: Queued External project and notes.md
    - button "Edit queued message"
    - button "Remove queued message"
    - button "Steer queued message" [disabled]
# Draft reference order
- Draft start: External project after start existing tail
- Draft middle: left External project after middle right
- Consecutive chips: prefix External project External project after consecutive
- Restored draft: prefix External project External project after consecutive
# Restored composer references
- External project
- External project
# Composer reference hover
```text
@external/opaque
```
- Exact raw text appears in a role=tooltip body portal after 500ms; composer text is unchanged
- Pointer events are disabled; leaving the chip for the tooltip dismisses it
- light: visible, max-480px viewport-contained tooltip
- dark: visible, max-480px viewport-contained tooltip
