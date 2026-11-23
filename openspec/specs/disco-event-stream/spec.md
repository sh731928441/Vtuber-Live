# disco-event-stream Specification

## Purpose

定义 Disco 页面与 Vtuber-Live 服务端之间通过现有 WebSocket 入口交换结构化场景事件、角色快照和运镜指令的行为，同时保持现有 AI 回复、语音和其他展示页面连续工作。

## Requirements

### Requirement: 复用现有 WebSocket 入口
Disco SHALL（必须）通过现有 `/ws` 连接接收实时事件，不得要求运营者再启动独立消息服务。现有 AI、语音、Live2D 和其他页面 SHALL（必须）继续使用同一个连接入口，各自处理与自身相关的消息。

#### Scenario: Disco 与 Live2D 同时连接
- **WHEN** `/disco` 和 `/live2d` 页面同时连接到 `/ws`
- **THEN** 两个页面都收到自身可识别的消息，任一页面的处理不会阻塞另一页面

### Requirement: 结构化 Disco 事件与展示事件并行
系统 SHALL（必须）将同一有效直播事件同时提供给结构化 Disco 事件流和现有 AI 处理链。AI 回复配置中的过滤、合并、冷却或暂停 SHALL NOT（不得）阻止 Disco 接收与该配置无关的角色和运镜事件。

#### Scenario: 弹幕被 AI 规则冷却
- **WHEN** 一条弹幕因现有 AI 冷却规则不生成回复
- **THEN** Disco 仍可收到对应的结构化弹幕事件并更新角色气泡

#### Scenario: Disco 模式开启
- **WHEN** Disco 页面正在接收事件
- **THEN** 现有 AI、语音、点歌和游戏仍按原有流程处理各自事件，不因 Disco 连接而停用

### Requirement: Disco 事件具有明确动作和身份
每条结构化 Disco 事件 SHALL（必须）包含可区分的动作类型和稳定用户标识。支持的动作 MUST（必须）至少包括创建角色、移动、显示弹幕气泡、切换皮肤、聚焦角色、DJ 台镜头和销毁角色。角色创建与移动事件 MUST（必须）只依赖统一舞区范围内的 X/Y，不要求 `band` 字段。无法识别或缺少必要字段的消息 SHALL（必须）被忽略并记录错误，MUST NOT（不得）中断 WebSocket 或清空现有场景。

#### Scenario: 创建角色
- **WHEN** 收到包含动作 `create`、用户标识和可用角色的 Disco 事件
- **THEN** 场景为该用户创建一个位于统一舞区合法范围内的角色

#### Scenario: 弹幕内容过长
- **WHEN** 弹幕气泡内容超过配置长度上限
- **THEN** 系统按配置截断或丢弃该气泡内容，不破坏角色和其他场景对象

#### Scenario: 收到未知动作
- **WHEN** Disco 页面收到无法识别的动作类型
- **THEN** 页面忽略该消息并输出可诊断日志，现有角色继续正常动画

### Requirement: 旧双活动带配置自动迁移
配置加载 SHALL（必须）支持把旧 `disco.bands.mid` 与 `disco.bands.near` 自动迁移为单一 `disco.dance_floor`。迁移后的 X/Y 范围 MUST（必须）覆盖两个旧活动带的并集，缩放与亮度端点 SHALL（必须）分别采用后侧和旧近景前侧的配置值。迁移结果 MUST（必须）在配置校验和页面加载前生效，现有角色坐标不得因迁移被无故重置。

#### Scenario: 加载旧双活动带配置
- **WHEN** 配置中只有有效的 `bands.mid` 和 `bands.near`
- **THEN** 系统生成统一 `dance_floor`，其 X/Y 范围覆盖两个旧范围，并继续使用现有角色坐标

#### Scenario: 新配置已存在
- **WHEN** 配置中已有有效的 `dance_floor`
- **THEN** 系统直接使用该舞区，不根据旧活动带覆盖其范围

### Requirement: 角色支持四向和斜向移动
Disco SHALL（必须）支持左、右、上、下以及任意两个正交方向的组合移动。`上` MUST（必须）减小 Y，`下` MUST（必须）增大 Y；水平分量 MUST（必须）更新角色朝向，纯垂直移动 MUST NOT（不得）改变角色朝向。斜向指令中每个方向后的距离 SHALL（必须）分别作为对应轴的位移，不得把两个分量归一化。单方向移动语法 MUST（必须）继续兼容。

#### Scenario: 水平移动兼容
- **WHEN** 用户发送 `/disco 移动 左 20`
- **THEN** 角色 X 减少 20，角色朝向左侧，Y 保持不变

#### Scenario: 垂直移动
- **WHEN** 用户发送 `/disco 移动 上 30`
- **THEN** 角色 Y 减少 30，并保持原朝向

#### Scenario: 斜向移动
- **WHEN** 用户发送 `/disco 移动 左 20 上30`
- **THEN** 角色 X 减少 20、Y 减少 30

#### Scenario: 反序斜向移动
- **WHEN** 用户发送 `/disco 移动 下 30 右 10`
- **THEN** 角色 X 增加 10、Y 增加 30

#### Scenario: 斜向移动到达边界
- **WHEN** 斜向目标只在一个轴上超出舞区
- **THEN** 系统夹取该轴并保留另一轴的有效位移

#### Scenario: 无效方向组合
- **WHEN** 指令重复同一轴、包含多个冲突方向或缺少有效方向
- **THEN** 系统拒绝该指令，不移动角色

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

### Requirement: 同一用户只有一个活动角色
系统 SHALL（必须）将同一平台和用户标识映射到最多一个活动 Disco 角色。同一用户重复发送创建事件时，系统 MUST（必须）更新现有角色状态或忽略重复创建，不得创建无限重复角色。

#### Scenario: 重复发送创建事件
- **WHEN** 同一用户在一次直播期间多次发送创建角色事件
- **THEN** 场景只保留一个绑定该用户的角色

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

### Requirement: 重连后恢复场景快照
Disco 页面建立或重新建立 `/ws` 连接后，系统 SHALL（必须）提供一次完整场景快照，包含当前启用状态、配置、角色数量以及每个活动角色的身份、位置、皮肤和气泡状态。增量事件不得作为新页面的唯一恢复依据。

#### Scenario: OBS 页面刷新
- **WHEN** 页面刷新后重新连接并且后端仍有活动角色
- **THEN** 页面根据快照恢复这些角色，而不是从空场景重新开始

#### Scenario: WebSocket 短时断开
- **WHEN** 网络短暂断开后页面重新连接
- **THEN** 页面用快照替换旧画面状态并继续处理新事件，不显示重复角色

### Requirement: 配置变更无需刷新页面
Disco SHALL（必须）通过现有实时消息入口接收启用状态、角色上限、销毁时长、舞区范围、固定资源布局、动态物品列表、物品顺序、场景资源和镜头参数变更。有效配置更新后，页面 MUST（必须）在不刷新浏览器的情况下应用新配置。

#### Scenario: 修改物品布局
- **WHEN** 运营者修改动态物品的位置或宽高
- **THEN** 已打开的 Disco 页面立即更新该物品，不需要刷新

#### Scenario: 调整物品顺序
- **WHEN** 运营者把动态物品上移或下移
- **THEN** 已打开的 Disco 页面立即应用新的物品前后顺序

#### Scenario: 修改角色上限
- **WHEN** 运营者在配置界面将角色上限从 100 改为 60
- **THEN** 已打开的 Disco 页面收到配置更新，后续创建事件按新上限执行

#### Scenario: 关闭 Disco
- **WHEN** 运营者关闭 Disco 功能
- **THEN** 已打开的 Disco 页面停止显示直播角色并展示停用状态，AI 和语音流程继续工作

### Requirement: 活动范围变化立即约束角色
系统 SHALL（必须）验证统一舞区的 X/Y 范围形成非空矩形。有效范围变更后，后端 MUST（必须）立即检查所有活动角色，并把超出舞区的角色夹回最近合法 X/Y，同时向已打开页面发送准确的新坐标。无效范围 SHALL（必须）被拒绝，且不得破坏现有角色或配置。

#### Scenario: 运行中缩小范围
- **WHEN** 运营者缩小舞区边界且部分角色位于新范围外
- **THEN** 系统立即夹回这些角色的 X/Y 并同步更新页面，不等待下一次移动事件

#### Scenario: 无效范围
- **WHEN** 配置中的最小 X 大于最大 X，或舞区形成空矩形
- **THEN** 系统提示配置无效，保留原范围和角色位置

#### Scenario: 扩大范围
- **WHEN** 运营者扩大舞区范围
- **THEN** 已有角色位置保持不变，后续移动和新创建角色使用扩大后的合法范围

### Requirement: 暂停时真正停止 Disco 服务
Disco SHALL（必须）具有可区分的运行和暂停服务状态。暂停后后端 MUST（必须）取消角色超时清理任务，不得只依赖每秒执行一次的 `tick` 空转；`/api/config` SHALL（必须）返回后端实际运行状态。暂停 SHALL NOT（不得）停止 `/ws`、控制台、AI、语音或 Live2D。

#### Scenario: 程序启动时 Disco 关闭
- **WHEN** Vtuber-Live 启动且 `disco.enabled` 为 `false`
- **THEN** 不创建 Disco 角色超时清理任务，也不处理直播事件的 Disco 副本

#### Scenario: 从运行状态暂停
- **WHEN** 运营者点击“暂停”
- **THEN** 后端取消 Disco 周期任务、清空活动角色并返回 `disco_running: false`

#### Scenario: 暂停后再次启动
- **WHEN** 运营者再次点击“启动”
- **THEN** 后端创建一个新的清理任务、开始接收后续 Disco 事件并返回 `disco_running: true`
