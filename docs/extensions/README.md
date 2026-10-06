---
description: "Self-service integration guides for extension authors working in other workspaces."
---

# Extension integrations

English | [中文](README.zh.md)

## Summary

Use these guides to connect an extension to optional DSH capabilities without changing the DSH runtime. Each guide identifies the supported API, the extension's responsibilities, deployment prerequisites, and verification evidence to return from another workspace.

## Table of Contents

- [Choose a guide](#choose-a-guide)
- [Work in another workspace](#work-in-another-workspace)
- [Further exploration](#further-exploration)

-----

<a id="choose-a-guide"></a>
## Choose a guide

[SigNoz and OpenTelemetry](signoz.md) covers optional performance instrumentation for Host plugins and separately launched processes. SigNoz is an example OTLP backend, not a required runtime dependency.

-----

<a id="work-in-another-workspace"></a>
## Work in another workspace

Give the implementation agent the target workspace, its actual package and process entry points, and the relevant guide. Require source inspection before edits; a diagnostic build artifact is not evidence that a functional integration exists. Keep implementation and tests in the owning workspace, and obtain operator approval before changing collection policy or exporting data.

The guide's task checklist is a handoff specification, not a statement that an arbitrary external extension has been integrated or tested. Report executed checks, unverified ingestion, and deployment prerequisites separately.

-----

<a id="further-exploration"></a>
## Further exploration

- [Extension authoring](../cookbook/extension-cookbook.md)
- [Cordis configuration and service access](../cordis-primer.md)
- [Runtime API references](../subsystems/README.md)

### Dev Note

None.
