# Select the model from JetBrains IntelliJ

English | [中文](intellij-model-selection.zh.md)

This opt-in overlay makes `dsh --profile acp` publish the model surface JetBrains IntelliJ 2026.2 reads. Clients that implement the current ACP session configuration options need none of it.

## Why the standard surface is not enough

IntelliJ 2026.2 reads model values only from the flat variant of `SessionConfigSelectOptions`, so the provider-grouped `model` option the ACP server normally publishes renders as an empty selector. The editor also registers a model toggle from the superseded `models` state on `session/new` and changes models by sending `session/set_model`, neither of which the standard method set provides.

## Launch

```sh
dsh --profile acp --patch "$PWD/apps/cli/config/examples/intellij-model-selection/cordis.yml"
```

Register that invocation as an ACP agent in the IDE. To keep the choice across runs, merge the file's single patch into `$DSH_HOME/profiles/acp/cordis.patch.yml`, which applies to every launch of the profile.

## What the editor then sees

- One flat model list whose labels read `Provider: Model`, so equal model names on different routes stay distinct.
- A `models` state on `session/new` and `session/resume`, carrying the same values as `modelId`.
- `session/set_model`, accepting a `modelId` from that state and routing the next turn through it.

The standard `session/set_config_option` keeps working beside all three, and both surfaces read the same catalog.

## Limits

- The patch replaces the profile row's whole config, so it restates `provider` and `model`. A deployment that changes the profile's route updates both places.
- The flat list loses the provider grouping for every client of that server, including clients that render groups.
- `models` and `session/set_model` are the superseded shape, not part of ACP v1. They exist for clients that still send them and should be dropped once the editor reads session configuration options.
