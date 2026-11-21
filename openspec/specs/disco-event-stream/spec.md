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
每条结构化 Disco 事件 SHALL（必须）包含可区分的动作类型和稳定用户标识。支持的动作 MUST（必须）至少包括创建角色、移动、显示弹幕气泡、切换皮肤、聚焦角色、DJ 台镜头和销毁角色。无法识别或缺少必要字段的消息 SHALL（必须）被忽略并记录错误，MUST NOT（不得）中断 WebSocket 或清空现有场景。

#### Scenario: 创建角色
- **WHEN** 收到包含动作 `create`、用户标识和可用角色的 Disco 事件
- **THEN** 场景为该用户创建一个位于合法活动带内的角色

#### Scenario: 弹幕内容过长
- **WHEN** 弹幕气泡内容超过配置长度上限
- **THEN** 系统按配置截断或丢弃该气泡内容，不破坏角色和其他场景对象

#### Scenario: 收到未知动作
- **WHEN** Disco 页面收到无法识别的动作类型
- **THEN** 页面忽略该消息并输出可诊断日志，现有角色继续正常动画

### Requirement: 同一用户只有一个活动角色
系统 SHALL（必须）将同一平台和用户标识映射到最多一个活动 Disco 角色。同一用户重复发送创建事件时，系统 MUST（必须）更新现有角色状态或忽略重复创建，不得创建无限重复角色。

#### Scenario: 重复发送创建事件
- **WHEN** 同一用户在一次直播期间多次发送创建角色事件
- **THEN** 场景只保留一个绑定该用户的角色

### Requirement: 角色上限和超时销毁
Disco SHALL（必须）支持可配置的同屏角色上限和角色存活时长。默认上限 MUST（必须）为 100，默认无互动销毁时长 MUST（必须）为 10 分钟。达到上限后系统不得继续创建角色，并应保留现有角色稳定显示。

#### Scenario: 达到角色上限
- **WHEN** 新用户创建角色时已有 100 个活动角色
- **THEN** 系统拒绝新的场景角色创建并保留现有 100 个角色

#### Scenario: 角色超时
- **WHEN** 角色连续 10 分钟没有新的弹幕、礼物或其他有效互动
- **THEN** 系统向页面发送销毁事件并释放该角色占用的数量配额

### Requirement: 重连后恢复场景快照
Disco 页面建立或重新建立 `/ws` 连接后，系统 SHALL（必须）提供一次完整场景快照，包含当前启用状态、配置、角色数量以及每个活动角色的身份、位置、皮肤和气泡状态。增量事件不得作为新页面的唯一恢复依据。

#### Scenario: OBS 页面刷新
- **WHEN** 页面刷新后重新连接并且后端仍有活动角色
- **THEN** 页面根据快照恢复这些角色，而不是从空场景重新开始

#### Scenario: WebSocket 短时断开
- **WHEN** 网络短暂断开后页面重新连接
- **THEN** 页面用快照替换旧画面状态并继续处理新事件，不显示重复角色

### Requirement: 配置变更无需刷新页面
Disco SHALL（必须）通过现有实时消息入口接收启用状态、角色上限、销毁时长、场景资源和镜头参数变更。有效配置更新后，页面 MUST（必须）在不刷新浏览器的情况下应用新配置。

#### Scenario: 修改角色上限
- **WHEN** 运营者在配置界面将角色上限从 100 改为 60
- **THEN** 已打开的 Disco 页面收到配置更新，后续创建事件按新上限执行

#### Scenario: 关闭 Disco
- **WHEN** 运营者关闭 Disco 功能
- **THEN** 已打开的 Disco 页面停止显示直播角色并展示停用状态，AI 和语音流程继续工作

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
