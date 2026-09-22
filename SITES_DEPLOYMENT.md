# OpenAI Sites 部署流程

本文档记录 Memoirs 迁移到 OpenAI Sites 后的部署方式。Sites 版本不运行 Django/Python，而是使用 Worker 后端、D1 数据库和 R2 对象存储来承接主要线上能力。

## 1. 当前 Sites 架构

Sites 相关文件：

- `.openai/hosting.json`：Sites 项目 ID 和运行时绑定声明。
- `worker/index.js`：Cloudflare Worker 风格的后端入口。
- `scripts/build-sites.mjs`：把 Worker 和前端产物整理到 Sites 需要的 `dist/` 结构，并用 esbuild 打包 Worker 依赖。
- `dist/server/index.js`：部署包中的 Worker 入口，由构建脚本生成，已内置 ZIP 解压依赖。
- `dist/client/static/frontend/`：部署包中的 React/Vite 前端静态资源。

当前绑定：

```json
{
  "project_id": "appgprj_6ab132518c7081918b348fb88f5e7330",
  "d1": "DB",
  "r2": "MEDIA"
}
```

注意：`d1` 和 `r2` 在当前 Sites 校验中使用字符串绑定名，不是数组或对象。之前尝试 `["DB"]`、`[{"binding":"DB"}]` 都无法保存版本。

## 2. Django 到 Sites 的对应关系

| 原 Django 能力 | Sites 版实现 |
| --- | --- |
| Django view/template | `worker/index.js` 返回页面壳并注入 React 初始数据 |
| Django JSON API | `worker/index.js` 中的 `/api/...` 路由 |
| PostgreSQL/SQLite | D1 绑定 `DB` |
| `Memoir` 表 | D1 表 `memoirs` |
| `MemoirMedia` 表 | D1 表 `media_items` |
| `MEDIA_ROOT` 本地/Volume 文件 | R2 绑定 `MEDIA` |
| Django session/auth | 依赖 Sites 私有访问边界，Worker 内部用单用户上下文 |
| Django Admin | 尚未迁移 |
| 备份 ZIP 导入 | `worker/index.js` 解析 Django 版 ZIP，写入 D1/R2 |
| 手机扫码上传 | 尚未迁移 |

Sites 版目前覆盖回忆文本 CRUD、回收站、相册读取、基础媒体上传路径，以及 Django 版备份 ZIP 导入。它适合作为当前私有站点的轻量线上后端，但不是 Django 的完整逐字节替代。

## 3. 本地构建

运行：

```powershell
npm run sites:build
```

这个命令会先构建 React 前端，再执行 `scripts/build-sites.mjs`，把发布所需文件放入 `dist/`。

建议同时检查：

```powershell
npm run frontend:check
Get-Content worker\index.js | node --input-type=module --check
```

## 4. 打包内容

Sites 保存版本时上传的 archive 应只包含发布所需内容，而不是整个项目源码：

```text
.openai/
dist/
```

当前手动打包命令：

```powershell
$archive = Join-Path $env:TEMP 'memoirs-sites-worker.tar'
if (Test-Path $archive) { Remove-Item $archive }
tar -cf $archive .openai dist
```

不要把临时 token、`.env`、本地数据库、`media/` 或其他私密文件打进部署包。

## 5. 发布流程

完整发布顺序：

1. 修改源码。
2. 运行 `npm run sites:build`。
3. 运行必要检查，例如 `npm run frontend:check` 和 Worker 语法检查。
4. 提交当前源码到 Git。
5. 通过 Sites 短期写入凭证，把当前 commit 推送到 Sites 源仓库。
6. 运行 `git rev-parse --verify HEAD`，把完整 commit SHA 用于保存 Sites version。
7. 用 `.openai/` 和 `dist/` 打包生成 tar archive。
8. 调用 Sites 保存版本。
9. 部署保存好的 version 到生产。
10. 查看部署状态，确认生产 URL 成功。

关键原则：

- 保存 version 的 `commit_sha` 必须是已经推送到 Sites 源仓库的当前 `HEAD`。
- archive 必须来自同一个源码状态构建出来的产物。
- Sites token 只用于单次 Git 命令，不写入 remote URL、Git 配置、源码或文档。
- 新站点默认私有；除非明确需要公开访问，否则保持当前访问策略。

## 6. 验证步骤

部署后建议检查：

```powershell
npm run frontend:check
git status --short --branch
```

在 Sites 工具中确认：

- 部署状态为 `succeeded`。
- 生产 URL 为 `https://memoirs.xzy666999.chatgpt.site`。
- D1 绑定包含 `DB`。
- D1 表包含 `memoirs` 和 `media_items`。

如果站点保持私有，未登录的命令行请求可能返回 `403 Forbidden`。这通常是 Sites 访问控制生效，不等同于 Worker 后端 500。请用已登录且有权限的浏览器打开站点做页面级验证。

## 7. 常见问题

### 保存版本时报 `.openai/hosting.json` 无效

优先检查 `d1` 和 `r2` 是否是字符串：

```json
{
  "d1": "DB",
  "r2": "MEDIA"
}
```

不要写成：

```json
{
  "d1": ["DB"],
  "r2": ["MEDIA"]
}
```

### D1 没有表

Worker 会在首次请求时自动建表。如果刚部署完成立刻查看，表可能还没出现。打开一次站点页面后，再检查 D1。

### 命令行访问生产 URL 返回 403

当前站点是私有访问模式，仅 owner 或被允许用户能访问。未认证 `curl` 返回 403 是预期行为。

### 导入 ZIP 失败

Sites 版只接受本应用导出的 ZIP：根目录必须包含 `manifest.json` 和 `memoirs.json`，媒体文件路径必须位于 `media/` 下。Django 导出的 JSON 成员通常是 deflate 压缩，Worker 发布产物必须由 `npm run sites:build` 打包，确保 ZIP 解压依赖进入 `dist/server/index.js`。ZIP 内引用的媒体缺失、路径不安全、日期格式异常或媒体类型无法识别时，导入会拒绝整包，避免生成不完整回忆。

当前页面默认走大备份任务协议，不再整包 POST ZIP。浏览器先读取清单，普通媒体逐文件上传，超过 24 MB 的媒体按 8 MB 分片写入 R2，全部完成后才把 D1 暂存记录发布到回忆库。进度停在某个文件时，应先检查该媒体本身是否完整；上传失败会自动取消任务并清理已上传对象。当前不支持 ZIP64，ZIP 总大小需低于 4 GB，单次最多 500 段回忆和 2000 个媒体文件。发布前可运行 `npm run sites:import-smoke` 验证浏览器端 ZIP 和分片流程。

### 想恢复 Django 完整能力

Sites 版不是 Django runtime。需要 Django Admin、手机扫码上传等能力时，仍应使用 Django 部署路线，或继续把对应功能迁移到 Worker/D1/R2。
