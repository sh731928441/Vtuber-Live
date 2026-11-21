# Spec Delta

## Purpose

定义独立 Disco 网页的加载、构建和兼容边界，确保该页面可以由现有本机服务直接提供给 OBS，同时不改变 Live2D 模型页面的依赖、资源或运行行为。

## ADDED Requirements

### Requirement: 提供独立 Disco 页面
系统 SHALL（必须）提供 `/disco` 页面作为独立浏览器源。该页面 MUST（必须）具有完整的场景、镜头、连接和错误提示能力，不得依赖操作者手工打开其他业务页面才能显示基础场景。

#### Scenario: 直接用 OBS 打开 Disco
- **WHEN** 用户将 `http://127.0.0.1:8787/disco` 添加为 OBS 浏览器源
- **THEN** 页面独立加载完整夜店场景并通过 `/ws` 开始接收事件

### Requirement: Disco 依赖与 Live2D 隔离
Disco SHALL（必须）使用自身的打包产物和渲染依赖。Disco 的依赖升级、构建失败或页面错误 SHALL NOT（不得）修改 `/live2d` 页面内容、模型接口或将 Live2D 使用的渲染运行时替换为 Disco 运行时。

#### Scenario: Disco 打包产物更新
- **WHEN** 发布新的 Disco 构建产物
- **THEN** `/live2d` 页面仍加载原有模型、依赖和行为，不需要同步修改

#### Scenario: Disco 页面脚本异常
- **WHEN** `/disco` 页面因资源或运行错误无法显示舞台
- **THEN** `/live2d`、控制台和其他现有页面仍可独立连接和运行

### Requirement: 构建产物无需开发环境
发布包 SHALL（必须）包含已构建的 Disco 页面、脚本、样式和场景资源。运行 Vtuber-Live 时 MUST NOT（不得）要求用户安装 Node.js、执行 Vite 或访问外部 CDN。

#### Scenario: 在无 Node.js 的机器启动
- **WHEN** 用户运行发布版 Vtuber-Live 并打开 `/disco`
- **THEN** 页面从本机静态资源完成加载，不需要启动开发服务器

#### Scenario: 网络不可用
- **WHEN** 本机没有互联网连接，但 Vtuber-Live 服务已启动
- **THEN** Disco 的脚本、字体、纹理和场景资源仍能从本机加载

### Requirement: 固定 UI 不随镜头移动
Disco 页面 SHALL（必须）将在线人数、调试状态和镜头模式等界面固定在屏幕坐标系中，不得随世界镜头平移或缩放。默认直播画面 SHALL（必须）隐藏调试界面，并允许通过配置开启。

#### Scenario: 镜头向左移动
- **WHEN** 镜头在世界中向左巡游或聚焦
- **THEN** 屏幕上的固定 UI 保持原位，不跟随背景和角色移动

#### Scenario: 默认 OBS 画面
- **WHEN** 用户首次打开 Disco 页面
- **THEN** 调试信息和鼠标操作提示默认不可见

### Requirement: 渲染不可用时清晰降级
当浏览器不支持所需图形能力或场景初始化失败时，页面 SHALL（必须）显示可读错误信息，而不是持续显示空白画布。错误信息 MUST NOT（不得）导致现有直播事件处理或后端连接进程崩溃。

#### Scenario: WebGL 初始化失败
- **WHEN** 浏览器无法创建所需图形上下文
- **THEN** `/disco` 显示浏览器兼容性错误，其他 Vtuber-Live 页面继续正常工作

### Requirement: 停用页面不持续渲染
Disco 服务暂停时，已经打开的 `/disco` 页面 SHALL（必须）停止 PixiJS ticker、动画和持续绘制，只保留轻量 WebSocket 监听与停用提示。页面以停用状态首次打开时 MUST NOT（不得）初始化 WebGL 场景；收到启动消息后才创建图形场景并恢复快照角色。

#### Scenario: 停用状态下打开 Disco
- **WHEN** 用户打开 `/disco` 且服务处于暂停状态
- **THEN** 页面显示停用提示，不创建渲染器、不启动动画循环，并继续等待启动消息

#### Scenario: 运行中暂停
- **WHEN** 已打开的 Disco 页面收到 `enabled: false`
- **THEN** 页面停止 ticker、隐藏画布并清空角色，处理器和 WebSocket 仍保持响应

#### Scenario: 页面暂停后重新启动
- **WHEN** 已打开但暂停的页面收到 `enabled: true`
- **THEN** 页面启动现有场景或按需创建场景，并从最新状态恢复角色显示
