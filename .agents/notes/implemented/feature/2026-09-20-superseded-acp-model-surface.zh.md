# Agent Note: 被取代的 ACP 模型界面

Status: implemented

[English](2026-09-20-superseded-acp-model-surface.md) | 中文

> 本说明修正[标准 ACP v1 自动化控制](2026-08-22-standard-acp-automation-controls.zh.md)中的两处表述：它按提供方分组的 `model` 选择项，以及它拒绝自定义方法的立场。两者仍是默认行为；本说明在其旁增加一个部署级的选择加入。它关于 ACP 不得成为第二个产品界面的禁令仍然有效。

## Problem

ACP 用 `session/set_config_option` 与 `SessionConfigSelectOptions` 取代了会话模型列表 —— 即 `session/new` 上的 `models` 状态与 `session/set_model` 方法。JetBrains IntelliJ 2026.2 只部分读取替代者，并且仍在讲替代者的前身，因此桥接器公布的标准界面在该编辑器中不渲染任何模型控件：

- 它的配置选项开关只从 `SessionConfigSelectOptions` 的扁平变体读取取值。按提供方分组的 `model` 选项会产生空取值列表，于是选择器存在却没有任何内容。
- 它的旧版模型开关从 `models` 状态注册，而标准响应省略该字段；它通过发送 `session/set_model` 更改模型，而标准方法集不注册该方法。

只使用该编辑器的部署因此无法选择模型，尽管通用 ACP 控制器可以。这两个缺口本身都不是 DSH 的缺陷：分组形式和该方法集都是有意为之，只是该编辑器落后于协议。

## Decision

`AcpConfig` 增加两个可选字段，各自默认保持当前行为，因此除非部署主动要求，否则没有任何变化：

| 字段 | 默认值 | 作用 |
|---|---|---|
| `modelOptions` | `grouped` | `flat` 会把 `model` 选择项公布为单一的 `SessionConfigSelectOption` 列表，而不是按提供方分组 |
| `legacyModelSelection` | `false` | `session/new` 与 `session/resume` 还会返回 `models`，并且桥接器还会注册 `session/set_model` |

**扁平形式。** 选项取值不变：每个取值仍是 `["<provider>","<model>"]` 不透明对，因此客户端可以在两种形式之间切换而无需重新解释某个选择。只有标签变化 —— 每个标签变成 `<提供方名称>: <模型名称>` —— 因为扁平列表没有分组行来标明提供方，否则不同提供方之间的同名模型将无法区分。

**被取代的界面。** `models` 为 `{ currentModelId, availableModels }`，其中每个 `availableModels` 条目把同一个不透明取值重复为 `modelId`，并携带相同的带提供方标签。`session/set_model` 接受 `{ sessionId, modelId }`，并返回被取代形状所期望的空对象；其取值必须是该状态中的 `modelId`，因此它像 `session/set_config_option` 的取值一样被校验，并报告相同的 `unknown model option` 失败。ACP v1 模式已不再描述该方法，因此桥接器用显式参数解析器而非生成的解析器注册它，并且只在 `legacyModelSelection` 下注册：未选择加入的部署会像以前一样回答 `Method not found`。

**单次目录读取。** 两个界面都来自同一次 `AcpModelControl.sessionConfig()` 结果 —— `AcpSession.sessionConfig()` 返回 `{ configOptions, legacy }` —— 因此两种协议不可能公布不同的目录；读取 `models` 的编辑器与读取 `configOptions` 的控制器会看到相同的模型和相同的顺序。当会话完全没有选择时，旧版状态是缺失而不是空值。

## Alternatives considered

**无条件使用扁平选项。** 每个客户端都能渲染扁平列表，因此这只需一行且无需新增配置，就能在所有地方修复该编辑器。否决原因：分组是有意为之的上游选择并且有真实消费者 —— 分组选项为支持它的客户端提供提供方行和未加限定的模型名，而 fork 不应为了迁就一个编辑器而改变每个部署的线上输出。加开关可让默认响应逐字节不变，这也是本包既有测试与快照完全不受影响的原因。

**无条件提供被取代的界面。** 多余响应字段会被做模式校验的客户端忽略，多余方法除非客户端调用否则不可达，因此实际风险很低。否决原因：[上游说明](2026-08-22-standard-acp-automation-controls.zh.md)基于词汇表的理由排除了未被请求的方法，而没有当前消费者的界面面积终究是界面面积。加开关让这一分歧成为部署事实而非包事实。

**用私有 `_meta` 字段或扩展方法代替被取代的标准名称。** 否决原因：目标就是回答已发布客户端实际发送的内容。私有名称会要求编辑器改动，而问题恰恰在此，那不是解决方案。

**把扁平形式与 `legacyModelSelection` 绑定。** 用一个开关同时控制两者会减少配置项。否决原因：两者互相独立 —— 客户端可以读取扁平列表却正常使用 `session/set_config_option`，也可以需要被取代的方法却渲染分组。把它们合并会把一个真实选择藏在一个不相关的选项之后。

**改为修改客户端。** 长期正确的修复是让编辑器读取分组选项和标准方法。此处做不到：已发布的编辑器版本就是如此，而部署现在就需要模型选择。

## Consequences

默认情况下上游行为不变。同时设置两个字段的部署会得到一个编辑器可用的选择器，其变更由下一轮次实际路由，代价是扁平的 `model` 列表和线上多出的一个方法；[包 README](../../../../packages/acp/acp/README.zh.md#minimal-configuration) 记录了两个字段。

扁平形式是同一个选项 id 的部署级属性，因此本包的两个部署可以用不同方式呈现同一目录。这是有意的取舍：替代方案是包级变更，而使用分组的客户端将无法回头。

`models` 是同一目录被公布两次的唯一位置。二者由同一次读取生成，因此不会漂移；但未来为标准选项新增字段时，必须有意识地考虑旧版形状，而不是直接复用。

测试分别固定选择加入与默认两条路径。包测试覆盖扁平标签、旧版状态、通过 `session/set_model` 且下一轮提示词实际使用的路由变更、畸形参数，以及界面关闭时的 `Method not found`；`apps/cli/tests/profiles/acp/tests/model-selection.e2e.ts` 中的真实 `dsh --profile acp` 进程测试会以补丁方式启用两个字段启动随附 profile，并通过真实客户端子进程断言同样的行为。
