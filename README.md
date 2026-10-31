# dsh-superpowers-bridge

一个面向 DeepSeek Harness（DSH）的独立插件，将上游 Superpowers 技能随包提供，并通过 DSH 原生技能接口注册。项目包含适配层，使内置技能按 DSH 的工具和权限约定运行。

本项目与 Superpowers 上游项目相互独立；它不是上游项目的官方发行，也不隶属于上游维护团队。

## 功能与工作方式

- 将固定版本的 Superpowers 技能资源随插件分发；运行时从本地资源加载，不联网获取技能，也不执行上游脚本。
- 通过 `ctx.skills.registerProvider()` 注册技能，并在系统提示中加入 Superpowers bootstrap。
- 将已包含技能的 `superpowers:<skill-name>` 引用转换为 DSH 使用的 `superpowers-<skill-name>` 名称；未知技能名保持不变。
- 注册前校验 vendored 资源与技能文件的 SHA-256 清单，发现文件损坏时拒绝加载。
- 由 Cordis 插件生命周期管理注册效果；卸载时清理技能与提示注册。

## 兼容性

版本约束来自 [`package.json`](package.json)：

- Node.js：`^22.19.0 || >=24.0.0`
- DSH：`^0.2.0-rc.2`
- Peer dependencies：
  - `@deepseek-ai/cordis`：`^4.0.4`
  - `@deepseek-ai/dsh-skill`：`^0.2.0-rc.2`
  - `@deepseek-ai/dsh-system-prompt`：`^0.2.0-rc.2`

使用前，请确认宿主 DSH 版本满足要求，并可解析以上 peer dependencies。插件以 `cordis.patch.yml` 声明 DSH bundle patch，具体加载方式应遵循所用 DSH 发行版的插件配置流程。

## 安装

仓库公开后，可在 DSH 项目中通过 GitHub 安装：

```sh
npm install github:zerohqing/dsh-superpowers-bridge
```

安装后，请按你的 DSH 宿主项目的插件配置流程启用 `dsh-superpowers-bridge`。本仓库当前不提供未经验证的宿主配置片段。

## 本地验证

在仓库目录中使用兼容版本的 Node.js 运行测试：

```sh
npm test
```

测试命令使用 Node.js 内置测试运行器。真实 Cordis 集成测试依赖 DSH 测试模块环境；未配置该环境时，该集成测试会跳过，其余测试仍会运行。

## 上游来源

随包技能来自 [obra/superpowers](https://github.com/obra/superpowers)。本项目会持续跟进上游更新，并在维护更新时同步随包技能；当前同步的上游版本、提交号与资源校验信息见 [`vendor/manifest.json`](vendor/manifest.json)。

## 许可证

项目自身的许可证见根目录 [`LICENSE`](LICENSE)。随包的上游 Superpowers 内容保留其原始许可证与版权声明，见 [`vendor/LICENSE.superpowers`](vendor/LICENSE.superpowers)。请分别查阅对应文件；本 README 不构成法律意见。
