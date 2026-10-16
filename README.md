# DeepSeek 对话导出助手

在 [chat.deepseek.com](https://chat.deepseek.com) 页面右下角加一个「导出」按钮，把当前对话一键存成 Markdown。

- **零权限** — 不申请任何浏览器权限，只有声明了站点访问范围
- **零依赖** — clone 下来直接加载，不需要 `npm install`，也没有构建步骤
- **零上传** — 只调用你已经登录的 DeepSeek 官方接口，数据不经过任何第三方服务器
- **带深度思考** — AI 的思维链默认保留，写在可折叠的 `<details>` 块里，也可以一键去掉

## 功能

- 一键把**当前对话**导出成一个 `.md` 文件
- 导出前弹出选择面板，按「轮」列出全部对话，可以只导出其中几轮
- 每一轮还能展开，单独勾选「提问」或「回答」
- 「保留深度思考」开关，决定思维链是否写进 Markdown
- 正文原样保留——代码块、表格、公式、列表都不会被破坏

## 安装

### Edge

1. 下载本仓库（`git clone` 或右上角 *Code → Download ZIP* 后解压）
2. 打开 `edge://extensions/`，打开左下角的「开发人员模式」
3. 点「加载解压缩的扩展」，选择**本仓库的根目录**（含 `manifest.json` 的那一层）
4. 打开 `https://chat.deepseek.com/` 任意一个对话，右下角会出现「导出」按钮

### Chrome

步骤一样，只是把 `edge://extensions/` 换成 `chrome://extensions/`。

## 使用

1. 打开一个对话，点右下角的「导出」
2. 面板列出这个对话里的每一轮。默认全选，取消勾选就不导出
3. 点轮次左边的 `▸` 可以展开，单独勾选某一轮的提问或回答
4. 「保留深度思考」默认开启，关掉后思维链不会写进文件
5. 点「导出 Markdown」，文件会自动下载，文件名取自对话标题

## 导出结果

````markdown
# 如何用 Python 读取 CSV 文件

> 来源：https://chat.deepseek.com/a/chat/s/abc123-def456
> 导出时间：2026-10-16 18:20:33 (GMT+8)
> 导出轮数：2 / 共 2 轮

---

## 第 1 轮

**用户**

CSV 里有中文乱码怎么解决？

**AI**

大概率是编码问题，指定编码即可：

```python
import pandas as pd
df = pd.read_csv("data.csv", encoding="utf-8-sig")
```

---

## 第 2 轮

**用户**

那如果文件有 10GB 呢？

**AI**

<details>
<summary>深度思考</summary>

用户问的是大文件读取，应该提 chunksize 参数……

</details>

用 `chunksize` 分块读取。
````

深度思考的 `<details>` 块在 GitHub、VS Code 预览、Typora 里都会渲染成一个可折叠的区域，默认收起。

## 隐私

这个扩展：

- 只在你的浏览器里运行，没有后台服务
- 只向你已登录的 `chat.deepseek.com` 发请求，用的是浏览器里现成的登录态
- 不收集、不上传、不存储任何数据
- 不在页面上留下任何持久化的东西——关掉面板，状态就没了

导出的文件直接由浏览器写到你本地的下载目录。

## 已知限制

- **依赖网页接口**。扩展走的是 DeepSeek 网页端自己的接口，不是公开 API。接口一变就可能失效，届时需要更新扩展。
- **用户提问可能被误解析**。你的提问原样写入文件，所以如果某条提问以 `#`、`>`、`-`、`1.` 开头，在 Markdown 里会被渲染成标题、引用或列表。这是刻意保留原样的代价——一旦转义，AI 回复里的代码块和公式也会跟着坏掉。介意的话，导出后手动给这几行加个反斜杠即可。
- **新对话导不了**。还没发过消息、地址栏里没有会话 id 的页面，扩展会提示你先发一条消息。
- **超长对话会慢一点**。几百轮的对话在读取和生成时会卡顿一两秒。

## 开发

```bash
# 跑逻辑测试（不需要装任何东西）
node tests/run.mjs

# 改了 icons/icon.svg 之后重新生成图标
python scripts/make_icons.py
```

测试用 Node 的 `vm` 造了个带 `window` 的沙箱，把不碰 DOM 的模块跑起来，所以「轮分组」和「Markdown 生成」这两块最容易出错的逻辑可以脱离浏览器验证，覆盖了连续提问、重新生成、首条就是 AI、只有思考没有正文、消息乱序、思考内容含尖括号等边界情况。

### 项目结构

```
manifest.json          MV3 清单，只声明 host_permissions，permissions 为空
src/
  shared.js            命名空间、常量、工具函数（必须最先注入）
  api.js               token 提取、请求封装、当前会话 id 解析
  messages.js          消息解析、归一化、按「轮」分组
  markdown.js          Markdown 渲染、文件名净化
  ui.js                悬浮按钮与选择面板
  main.js              启动入口（必须最后注入）
styles/panel.css       面板样式，全部以 #dsex-root 限定，不影响页面
icons/                 图标；icon.svg 是设计源，三个 png 由脚本生成
scripts/make_icons.py  纯标准库的 PNG 生成脚本
tests/                 逻辑单测
docs/DESIGN.md         为什么这么设计、数据结构长什么样、做了哪些取舍
```

因为 content script 没有模块系统，`src/` 下每个文件都用 IIFE 包住、往 `window.__DSEX__` 这个命名空间上挂东西，靠 manifest 里的数组顺序保证依赖关系。

想了解实现细节和取舍，见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可

[MIT](LICENSE)
