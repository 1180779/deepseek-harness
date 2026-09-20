# 在 JetBrains IntelliJ 中选择模型

[English](intellij-model-selection.md) | 中文

这个选择性加入的叠加层让 `dsh --profile acp` 公布 JetBrains IntelliJ 2026.2 所读取的模型界面。实现了当前 ACP 会话配置选项的客户端完全不需要它。

## 为什么标准界面不够

IntelliJ 2026.2 只从 `SessionConfigSelectOptions` 的扁平变体读取模型取值，因此 ACP 服务器通常公布的按提供方分组的 `model` 选项在该编辑器中呈现为空选择器。该编辑器还会从 `session/new` 上被取代的 `models` 状态注册模型开关，并通过发送 `session/set_model` 更改模型，而标准方法集两者都不提供。

## 启动

```sh
dsh --profile acp --patch "$PWD/apps/cli/config/examples/intellij-model-selection/cordis.yml"
```

把该调用注册为 IDE 中的 ACP agent。若要长期保留该选择，请把文件中的单条 patch 合并进 `$DSH_HOME/profiles/acp/cordis.patch.yml`，它会对该 profile 的每次启动生效。

## 编辑器随后看到的内容

- 单一扁平模型列表，标签形如 `提供方: 模型`，因此不同路由上的同名模型依然彼此区分。
- `session/new` 与 `session/resume` 上的 `models` 状态，携带与 `modelId` 相同的取值。
- `session/set_model`，接受该状态中的 `modelId`，并让下一轮次通过它路由。

标准的 `session/set_config_option` 与这三者并存且照常工作，两个界面读取同一目录。

## 限制

- 该 patch 会替换 profile 行的整个 config，因此它重新声明了 `provider` 与 `model`。更改 profile 路由的部署需要同时更新两处。
- 扁平列表会让该服务器的所有客户端失去按提供方分组，包括支持分组的客户端。
- `models` 与 `session/set_model` 是被取代的形状，不属于 ACP v1。它们服务于仍在发送它们的客户端，编辑器改读会话配置选项后应当移除。
