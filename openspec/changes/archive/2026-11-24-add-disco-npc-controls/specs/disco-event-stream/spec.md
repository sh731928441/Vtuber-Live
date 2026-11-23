# Spec Delta

## ADDED Requirements

### Requirement: 手动 NPC 具有独立运行期身份
服务端 SHALL（必须）允许控制台创建手动 NPC。NPC 显示名称 MUST（必须）依次为 `npc1`、`npc2`、`npc3`，内部 UID MUST（必须）使用保留命名空间 `npc:runtime:<索引>`。索引 SHALL（必须）在当前程序进程内单调递增，删除或 Disco 暂停后不得复用已消耗索引；程序重启后 MAY（可以）从 1 重新开始。显示名称允许与真实用户重名，但内部 UID MUST NOT（不得）与真实用户身份相同。

#### Scenario: 连续添加 NPC
- **WHEN** 运营者连续点击“添加 NPC”
- **THEN** 控制台依次创建显示名称为 `npc1`、`npc2` 的独立运行期角色

#### Scenario: 删除后继续添加
- **WHEN** 运营者删除 `npc2` 后再次添加 NPC
- **THEN** 新角色名称为 `npc3`，不会重新使用 `npc2`

#### Scenario: 真实用户与 NPC 同名
- **WHEN** 真实用户昵称是 `npc10` 且已创建真实角色，随后控制台创建手动 NPC `npc10`
- **THEN** 两个角色保留不同内部 UID，真实用户消息只路由到真实角色

### Requirement: 控制台管理运行期 NPC
控制台「Disco 舞台」的「角色与舞池」卡片 SHALL（必须）提供“添加 NPC”和“删除最后一个 NPC”控件，并显示当前手动 NPC 数量，不得展示逐项 NPC 列表。删除操作 MUST（必须）移除当前索引最大的手动 NPC。手动 NPC SHALL（必须）计入 `disco.max_characters` 上限，不参与无互动超时；Disco 暂停、重启或程序退出时 MUST（必须）与运行期角色一起清空。服务未运行时，添加或删除操作 SHALL（必须）返回明确错误且不得修改角色列表。

#### Scenario: 添加 NPC
- **WHEN** Disco 正在运行且角色数量未达到上限
- **THEN** 控制台创建 NPC，更新手动 NPC 数量，并立即向已打开舞台广播

#### Scenario: 删除最后一个 NPC
- **WHEN** 运营者点击“删除最后一个 NPC”
- **THEN** 只移除当前索引最大的手动 NPC，其他真实用户和 NPC 保持不变

#### Scenario: 没有可删除的 NPC
- **WHEN** 当前没有手动 NPC 且运营者点击删除
- **THEN** 控制台提示没有手动 NPC，不改变真实角色

#### Scenario: 达到角色上限
- **WHEN** 当前角色数量已达到 `disco.max_characters`
- **THEN** 添加 NPC 失败并提示已达到角色上限，现有角色不变

#### Scenario: Disco 暂停时操作 NPC
- **WHEN** Disco 服务处于暂停状态且运营者尝试添加或删除 NPC
- **THEN** 控制台提示服务未运行，不创建或修改角色

#### Scenario: Disco 暂停清空 NPC
- **WHEN** 运营者暂停 Disco 服务
- **THEN** 手动 NPC 与其他运行期角色一起清空

### Requirement: 控制台可向指定 UID 发送气泡
控制台 SHALL（必须）提供目标 UID 和气泡文本输入，并允许运营者对当前活动角色发送气泡。目标 UID MAY（可以）是当前平台的原始用户 UID，也 MAY（可以）是手动 NPC 的内部 UID。目标必须解析为唯一活动角色；目标不存在时 MUST（必须）提示“角色不存在”，且 MUST NOT（不得）自动创建角色。气泡文本 SHALL（必须）遵循 `disco.bubble_max_chars` 和现有气泡停留时长。

#### Scenario: 向真实用户发送气泡
- **WHEN** 运营者输入存在角色的当前平台用户 UID 和有效文本
- **THEN** 对应真实角色上方显示气泡，其他角色不显示该文本

#### Scenario: 向手动 NPC 发送气泡
- **WHEN** 运营者输入 `npc:runtime:1` 和有效文本
- **THEN** 只有内部 UID 为 `npc:runtime:1` 的手动 NPC 显示气泡

#### Scenario: 目标角色不存在
- **WHEN** 运营者输入的 UID 当前没有活动角色
- **THEN** 控制台提示“角色不存在”，不创建角色也不发送气泡

#### Scenario: 气泡文本为空
- **WHEN** 运营者未填写有效气泡文本
- **THEN** 系统拒绝发送并保持现有角色和气泡状态

### Requirement: 运营控件不进入直播事件管线
添加 NPC、删除 NPC 和指定 UID 发送气泡 MUST（必须）通过控制台运营 API 直接操作 Disco 状态，并广播必要的场景消息。这些操作 SHALL NOT（不得）作为直播弹幕、礼物或其他观众事件再次分发，MUST NOT（不得）触发 AI 回复、TTS、自动回复、点歌、游戏或其他页面的业务处理。

#### Scenario: 手动发送气泡
- **WHEN** 运营者使用指定 UID 控件发送气泡
- **THEN** 仅 Disco 气泡状态和舞台画面更新，AI、TTS 和直播事件流程均不执行

#### Scenario: 添加或删除 NPC
- **WHEN** 运营者添加或删除手动 NPC
- **THEN** 仅 Disco 角色状态更新，不生成任何直播观众事件或 AI 回复

## MODIFIED Requirements

### Requirement: 角色上限和超时销毁
Disco SHALL（必须）支持可配置的同屏角色上限和角色存活时长。默认上限 MUST（必须）为 100，默认无互动销毁时长 MUST（必须）为 10 分钟。达到上限后系统不得继续创建真实或手动角色，并应保留现有角色稳定显示。手动 NPC MUST（必须）计入上限，但 SHALL NOT（不得）因无互动超时被销毁。

#### Scenario: 达到角色上限
- **WHEN** 新用户或控制台尝试创建角色时已有 100 个活动角色
- **THEN** 系统拒绝新的场景角色创建并保留现有 100 个角色

#### Scenario: 角色超时
- **WHEN** 真实用户角色连续 10 分钟没有新的弹幕、礼物或其他有效互动
- **THEN** 系统向页面发送销毁事件并释放该角色占用的数量配额

#### Scenario: 手动 NPC 保持
- **WHEN** 手动 NPC 连续超过无互动销毁时长
- **THEN** NPC 继续显示，直到运营者删除、Disco 暂停或程序退出
