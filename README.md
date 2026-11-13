# Yufi

基于 [Dela](https://github.com/Chang-Yo/Dela) 改造的本地优先桌面助手，把 Canvas 课程资料、课堂录音转写、项目文件和终端放在同一个工作台。

## 本次改造

- **Canvas 登录**：通过应用内登录窗口与会话 Cookie 连接课程平台；调整学期名称识别，支持课程资料浏览与下载。
- **课堂笔记**：按课程管理录音，SenseVoice 提供实时预览，Qwen3-ASR 完成分句转写；支持时间戳、音频回放与拖动定位。
- **本地工作台**：沿用 Dela 的项目文件、Markdown 笔记、Agent 与内置终端；修复 macOS 终端启动和提示问题。
- **入口精简**：隐藏不适用于当前使用环境的课表、课堂视频与社区入口。
- **Microsoft 365 OAuth**：保留登录接入代码，实际邮箱权限仍需租户管理员批准。

录音、转写与回放已做本地验证；AI 整理笔记入口仍待实际验证。远程 SSH 尚未在本次改造中实测。此仓库提供开发源码，尚未发布 Yufi 安装包。

## 本地开发

使用 [`.node-version`](.node-version) 指定的 Node.js，以及 [`package.json`](package.json) 中指定的 pnpm 版本：

```sh
corepack pnpm install
corepack pnpm dev
```

检查与构建：

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:bundle
```

语音模型按应用提示准备；模型 API 密钥由使用者自行配置。课程会话、录音、邮件与模型凭据不随源码发布。使用外部模型整理笔记时，相关文本会发给所配置的模型服务。

## 来源与许可

Yufi 是 Dela 的衍生改造，桌面工作台与 Agent 框架来自原项目，非从零开发。保留 [GPL-3.0-or-later 许可证](LICENSE)、原作者署名与第三方素材许可。上游介绍见 [原始 README](README.upstream.md)。

本次以本地 `wku` 分支提交 `1a436b1` 为基础公开源码快照；本地开发仓库及其历史保持不变。上游 GitHub Actions 保存于 [工作流参考目录](docs/upstream-workflows)，此仓库暂不启用自动打包与发布。
