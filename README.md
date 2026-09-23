# dsh-chat-rail

DeepSeek Harness 静态 dual-face 插件：在对话区右缘提供一条 **DeepSeek 网页版风格的对话导航竖线**——每条人类消息对应一根短横线，鼠标靠近即展开可跳转的消息列表。

![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)

## 功能

- **静默态**：右侧一列灰色短横线，**当前视口中的那条为品牌蓝**；整条竖线带一层极淡的胶囊底，即使只加载出一条消息也能看出这是一个控件，且不遮挡正文；
- **悬停 / 聚焦**：向左展开圆角面板，列出本会话全部人类消息（当前项蓝色高亮，过长文本省略号截断，悬停显示完整内容）；
- **点击横线或列表行**：该消息滚回视口顶部；
- **跟随布局**：侧栏收放、详情栏开关、输入框增高、窗口缩放都会自动重新测量并跟随，位置贴着正文栏右缘（用聊天视图自己发布的 `[data-chat-flow]` 锚点定位，不写死任何布局类名）；
- **消息很多不溢出**：最小间距也放不下时按比例**抽样**，两端必留，横线永不超出聊天列；面板始终列出全部消息。

## 回溯更早的历史

客户端只持有会话日志的一个**窗口**，所以竖线只能给出已载入的部分——很长的会话里这个窗口可能只剩一条人类消息。因此只要还有更早的历史，面板顶部就会带一行 `↑ 载入更早的消息`：

- 点击一次把窗口往前扩一页，**新横线随之长出来**；
- 由于聊天视图会刻意保持阅读锚点，新内容会落在视口上方、看着像什么都没发生，所以加载完成后会把视图滚到**刚进来的那批消息中最新的那一条**，接着原来的位置继续往更早读；
- 面板全程常驻，可以连点，一路翻到底。

### 面板生命周期

| 操作 | 面板 |
| --- | --- |
| 指针停在竖线或面板上 | 展开 |
| 指针离开且未钉住 | `CLOSE_DELAY_MS` 后收起 |
| **面板内任意点击** | **钉住**——指针去哪都不收，加载全程也不收 |
| Escape，或点击面板外部 | 收起并解除钉住 |
| 点击某条消息 | 跳转后收起（交互结束） |
| 加载进行中 | 永不收起 |
| 测量瞬时失败 | 保留上一帧 `GEOMETRY_GRACE_MS`，不闪断 |

## 安装

```powershell
node tools/install.mjs              # 默认装进 `web` profile
node tools/install.mjs --profile web
node tools/install.mjs --remove     # 卸载
```

安装脚本把本包复制到 `<profile>/node_modules/dsh-chat-rail`，并在 `<profile>/package.json` 里登记（`dependencies` + `dsh.profile.bundles`），其余字节保持原样，同时留下 `package.json.bak` 备份。

**装完要重启 harness（`dsh web`）并刷新页面**：profile 的 bundle 层在启动时合成，新登记的 bundle 下次启动才挂载。之后改 `dsh/client.js` 只需刷新页面（`/plugins/...` 是每次请求从磁盘读的），不用再重启。

## 架构（dual-face，无构建步骤）

| 文件 | 半区 | 说明 |
| --- | --- | --- |
| `dsh/index.js` | Host | ESM 插件，**故意空实现**：功能全在浏览器侧，且不声明任何 `inject`，所以这一行永远不会卡在启动扫描的 pending 上 |
| `dsh/client.js` | Client | 手写 lazy-CJS bundle（`window.__ModuleLoader__.load`），与内置 client 插件、其他 profile bundle 同协议；挂载到 frame 级浮层 `shell.overlay`，无需批准、重启不丢失 |
| `cordis.patch.yml` | 组合层 | 本包的 profile patch：`- insert: [{ id: dsh-chat-rail, name: dsh-chat-rail }]` |

宿主侧的 client-module registry 会扫描已启用的 loader 条目，挑出声明了 `dsh.client` 的包，解析 `exports["./client"]`，把 bundle 哈希进 `window.__DSH_BOOT__`，并通过 `/plugins/dsh-chat-rail/client.js` 提供。

## 数据来源

只走公开客户端契约，没有 Host 往返：

| 需要 | 来源 |
| --- | --- |
| 当前会话 | `props.useSessions`（`shell.overlay` 的 root 作用域标准 props；缺失时回退直读 `sessions.list` 快照并订阅） |
| 消息 | `ctx.get('sessions').binding(id).session`——会话 face，即 `ObservableSnapshot<ConversationSnapshot>` |
| 消息文本 | `user` / `steering` 节点的 `content` 块，压成一行显示文本 |
| 滚动容器 | 聊天视图自己发布的结构锚点：`[data-conversation-scroll]`、`[data-chat-flow]`、`[data-chat-anchor-key]`、`[data-composer-seat]` |
| 浮层 | `[data-shell-overlay]`，竖线渲染进的那个 frame 级浮层 |

只有叶子标量（节点 key、消息字符串、矩形）会进入 React state；快照本身从不复制、不序列化、不长期持有。

## 性能

工作全部避开流式输出路径：

- 订阅把每次快照 flush 归约成一个廉价签名，签名没变就不提交；
- 只有当滚动偏移、内容高度、视口框或条目集合真的变了，才重新走一遍消息行；
- 在会话底部时"当前项"直接取最新一条，无需遍历任何行；
- 面板加载中不会因为布局抖动而重挂载（几何宽限期 + 状态放在组件外）。

## 可调参数

全部集中在 `dsh/client.js` 顶部的常量：

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `DASH_HEIGHT` / `DASH_WIDTH` / `DASH_GAP_MAX` / `DASH_GAP_MIN` | 4 / 20 / 9 / 3 | 横线几何 |
| `RAIL_CLEARANCE` | 40 | 正文栏右缘到竖线的间距 |
| `RAIL_EDGE_INSET` | 10 | 距滚动容器自身右缘的最小内缩 |
| `ACTIVE_THRESHOLD` | 32 | 距滚动容器顶部多少像素内仍算"当前" |
| `JUMP_OFFSET` | 16 | 跳转后消息上方的留白 |
| `CLOSE_DELAY_MS` | 160 | 面板与竖线之间移动的防闪烁宽限 |
| `GEOMETRY_GRACE_MS` | 1500 | 测量瞬时失败时保留旧帧的时长 |
| `DIAGNOSTIC` | `false` | 竖线本该出现却没出现时发一条自检报告（默认关，见下文） |

垂直方向默认在消息视口内**居中**（滚动容器顶部到输入框座位之间）；想改成顶对齐，改 `Rail` 根节点样式那一行即可。

## 测试

```powershell
node test/smoke.mjs      # 浏览器半区：合成 DOM + 真实 React 渲染
node test/manifest.mjs   # 安装脚本用的 profile manifest 文本改写
```

`test/smoke.mjs` 用替身 `window.__ModuleLoader__` 加载**真正的 bundle**，然后校验快照归约、横线排布/抽样数学、聊天取景测量、当前消息判定、跳转滚动、`ctx.effect` 下的样式与 slot 归属，以及用 `react-dom/server` 对注册组件做完整渲染（横线数量、高亮、定位、文案）。React 取自本机已安装的 harness，保证渲染用的是浏览器那一版。

## 自检与排错

`DIAGNOSTIC` **默认关闭**。打开后，插件只在"**竖线本该出现、却没有出现**"（不在 DOM、尺寸为 0、跑出视口、横线透明）时才向当前会话发一条 `[dsh-chat-rail 自检]` 报告，附上实测矩形、横线计算样式、视口尺寸和各 DOM 锚点存在性。

判断"本该出现"和渲染用的是**同一个谓词** `railExpected(itemCount, more, height)`：有消息、或还有更早的历史可载入、且视口高度够，才算该出现。所以**空白会话、窗口里没有人类消息且没有更早历史的会话都不会误报**——这种会话本来就没有可导航的内容。

之所以默认关掉：这份报告是**通过 `session.prompt` 发出去的**（会话只有这一个公开写入通道），所以它会以**一条"用户消息"的形式出现在对话里，并触发一轮 agent 回复**。只有在真的排查隐形竖线时才把它临时设为 `true`，排完记得改回来。


| 现象 | 原因 |
| --- | --- |
| 装完没有竖线 | 没重启 harness，启动图早于本 bundle |
| 某个会话里始终没有竖线 | 该会话还没有人类消息，或当前视图不是"对话"页签 |
| 启动时报 `cannot resolve profile bundle` | `<profile>/node_modules` 里缺本包目录 |
| 行挂上了但什么都不渲染 | 看浏览器控制台有无 `dsh-chat-rail` 报错；module loader 对加载失败的 bundle 会大声报错 |

## 许可

MIT
