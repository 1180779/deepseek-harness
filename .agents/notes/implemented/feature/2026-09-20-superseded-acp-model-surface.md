# Agent Note: Superseded ACP model surface

Status: implemented

English | [中文](2026-09-20-superseded-acp-model-surface.zh.md)

> This note qualifies two statements in [Standard ACP v1 automation controls](2026-08-22-standard-acp-automation-controls.md): its provider-grouped `model` select and its refusal of custom methods. Both remain the default; this note adds a deployment-scoped opt-in beside them. Its prohibition on ACP becoming a second product UI remains authoritative.

## Problem

ACP replaced the session model list — a `models` state on `session/new` and the `session/set_model` method — with `session/set_config_option` and `SessionConfigSelectOptions`. JetBrains IntelliJ 2026.2 reads the replacement only partly and still speaks the replacement's predecessor, so the standard surface the bridge publishes renders no model control in that editor:

- Its config-option toggle reads values only from the flat variant of `SessionConfigSelectOptions`. A provider-grouped `model` option produces an empty value list, so the selector exists with nothing in it.
- Its legacy model toggle registers from the `models` state, which the standard response omits, and it changes models by sending `session/set_model`, which the standard method set does not register.

A deployment whose only client is that editor therefore cannot select a model, even though a generic ACP controller can. Neither gap is a DSH defect on its own: the grouped form and the method set are deliberate, and the editor is simply behind the protocol.

## Decision

`AcpConfig` carries two optional fields, each defaulting to today's behavior, so no deployment changes unless it asks:

| Field | Default | Effect |
|---|---|---|
| `modelOptions` | `grouped` | `flat` publishes the `model` select as one `SessionConfigSelectOption` list instead of provider groups |
| `legacyModelSelection` | `false` | `session/new` and `session/resume` also return `models`, and the bridge also registers `session/set_model` |

**Flat presentation.** The option values are unchanged: every value stays the opaque `["<provider>","<model>"]` pair, so a client can move between the two presentations without reinterpreting a selection. Only the labels change — each becomes `<provider name>: <model name>`, because a flat list has no group row to name the provider and equal model names across providers would otherwise be indistinguishable.

**Superseded surface.** `models` is `{ currentModelId, availableModels }`, where each `availableModels` entry repeats the opaque value as `modelId` and carries the same provider-qualified label. `session/set_model` takes `{ sessionId, modelId }` and returns the empty object the superseded shape expects; its value must be a `modelId` from that state, so it is validated exactly like a `session/set_config_option` value and reports the same `unknown model option` failure. The ACP v1 schema no longer describes this method, so the bridge registers it with an explicit parameter parser rather than a generated one, and registers it only under `legacyModelSelection`: a deployment that does not opt in answers `Method not found`, exactly as before.

**One catalog pass.** Both surfaces come from a single `AcpModelControl.sessionConfig()` result — `AcpSession.sessionConfig()` returns `{ configOptions, legacy }` — so the two protocols cannot advertise different catalogs, and an editor reading `models` while a controller reads `configOptions` sees the same models in the same order. The legacy state is absent, not empty, when the session has no selection at all.

## Alternatives considered

**Flat options unconditionally.** Every client can render a flat list, so this fixes the editor everywhere with one line and no new configuration. Rejected because the grouping is a deliberate upstream choice with a real consumer: grouped options give clients that render them a provider row and an unqualified model name, and a fork should not change every deployment's wire output to accommodate one editor. Gating keeps the default response byte-identical, which is also why the package's existing tests and snapshots pass untouched.

**The superseded surface unconditionally.** An extra response field is ignored by schema-validating clients, and an extra method is unreachable unless a client calls it, so the practical risk is low. Rejected because [the upstream note](2026-08-22-standard-acp-automation-controls.md) rules out an unrequested method on vocabulary grounds, and surface area with no current consumer is still surface area. Gating makes the divergence a deployment fact rather than a package fact.

**A private `_meta` field or extension method instead of the superseded standard names.** Rejected because the objective is to answer what the shipped client already sends. A private name would require the editor to change, which is the problem, not the solution.

**Tying the flat presentation to `legacyModelSelection`.** One flag for both would be less configuration. Rejected because the two are independent: a client can read a flat list while using `session/set_config_option` normally, and a client can need the superseded method while rendering groups. Folding them would hide a real choice behind an unrelated one.

**Changing the client instead.** The correct long-term fix is for the editor to read grouped options and the standard method. It is not available here: the shipped editor version is what it is, and the deployment needs model selection now.

## Consequences

Upstream behavior is unchanged by default. A deployment that sets both fields gets an editor-usable picker whose changes are routed by the next turn, at the cost of a flat `model` list and one extra method on its wire; the [package README](../../../../packages/acp/acp/README.md#minimal-configuration) documents both fields.

The flat presentation is a per-deployment property of the same option id, so two deployments of this package can present the same catalog differently. That is the intended trade: the alternative is a package-wide change with no way back for clients that use groups.

`models` is the one place where the same catalog is published twice. The pair is generated from one pass, so they cannot drift, but a future field added to the standard option must be considered for the legacy shape deliberately rather than reusing it.

Testing pins the opt-in and the default separately. Package tests cover the flat labels, the legacy state, a route change through `session/set_model` that the next prompt actually uses, malformed parameters, and `Method not found` while the surface is disabled; a real `dsh --profile acp` process test in `apps/cli/tests/profiles/acp/tests/model-selection.e2e.ts` boots the shipped profile with both fields patched in and asserts the same behavior through a real client subprocess.
