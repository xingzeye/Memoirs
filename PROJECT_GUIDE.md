# 忆往昔项目全栈说明文档

> 本文档基于当前项目源码编写，用于从前端、后端、数据库到部署的完整交接和维护。
> 文档只描述当前实现，不修改运行代码、数据库结构或接口行为。

## 1. 项目总览

### 1.1 项目定位

`忆往昔` 是一个基于 Django 的私人回忆管理应用。项目面向个人或小范围私密使用，核心目标是让登录用户保存、浏览、搜索、编辑和删除自己的回忆，并为每条回忆附加照片或视频。

项目当前采用“本地优先 + 可公网部署”的设计：

- 本地开发默认使用 SQLite 数据库：`db.sqlite3`。
- 本地上传文件默认保存在：`media/`。
- 生产部署支持通过 `DATABASE_URL` 切换到 PostgreSQL，例如 Neon。
- 生产部署支持通过 `MEDIA_ROOT` 把上传媒体保存到持久化 Volume，例如 Zeabur Volume。
- 静态文件由 Django `collectstatic` 收集后，通过 WhiteNoise 在生产环境中提供。

### 1.2 核心功能

- 用户注册、登录、退出。
- 可通过环境变量关闭公开注册。
- 登录用户只能管理自己的回忆。
- 支持新增、编辑、移入回收站、恢复和永久删除回忆。
- 支持为回忆上传多张图片或多个视频。
- 支持编辑回忆时追加媒体文件，或删除已有媒体文件。
- 支持电脑端显示二维码，手机扫码后从手机相册上传照片或视频。
- 支持电脑直接选择文件和手机上传文件的缩略预览。
- 前端从会话上下文读取上传大小限制，选择文件时会拦截超过上限的照片/视频；提交时遇到非 JSON 的 400/413 上传失败响应也会显示明确中文提示。
- 支持按标题、正文、地点、心情标签搜索。
- 支持按已有心情标签筛选。
- 支持回忆列表中的图片/视频预览弹层。
- 支持回忆列表首批图片缩略图在页面打开时通过 head preload 和 eager/high priority 提示主动加载。
- 支持 `/memoirs/media/` 全站相册页，集中查看当前账号全部照片和视频；相册支持照片/视频、年份、地点筛选，按所属回忆日期分组，媒体格子不显示文字描述。
- 媒体预览弹层提供下载原图/原视频按钮；相册媒体还可从预览弹层跳回所属回忆详情页。
- 回忆库首页采用左侧深墨绿档案导航、顶部搜索筛选和紧凑时间线列表；统计区显示回忆、照片和视频数量。
- 回忆库侧栏是可交互的客户端视图切换：地点、心情、信笺和媒体会筛选当前列表，回收站会加载已软删除回忆并提供恢复/永久删除；时间排序可切换升降序，视图按钮可切换列表/媒体密度。
- 时间线视图只显示填写了 `memoryDate` 的回忆；未写日期的回忆保留在 `记忆中的TA` 全部列表中。
- 时间线行只渲染真实存在的媒体缩略图；没有媒体或媒体数量不足时不显示空占位框。
- 时间线行点击后进入独立回忆详情页，详情页展示完整正文和全部照片/视频。
- 图片缩略图通过受保护 WebP 缓存按需生成；视频缩略图在接近视口时才读取元数据，并通过 `Range` 响应改善移动端首帧加载。
- 用户可见界面由 React/Vite 接管，覆盖登录/注册、回忆库、编辑器和手机上传页面。
- Django Template 负责输出 React 挂载壳与初始 JSON 上下文，后续交互通过 Django JSON API 完成。
- 支持 Django Admin 后台管理回忆和媒体。
- 媒体文件通过受保护视图访问，不直接公开 `media/` 目录；原文件下载走 `?download=1` 私有响应。

### 1.3 技术栈

| 层级 | 当前技术 |
| --- | --- |
| 语言 | Python 3.12 |
| Web 框架 | Django 5.x |
| 前端渲染 | React 18 + Vite + TypeScript |
| 模板职责 | Django Template 作为 React 挂载壳 |
| 样式 | 原生 CSS 设计系统，源码为 `frontend/src/styles/app.css`，产物为 `static/frontend/app.css` |
| 交互 | React 组件 + Django JSON API；`static/frontend/app.js` 保留临时 fallback |
| 表单 | Django Forms |
| 认证 | Django 内置 Auth |
| 本地数据库 | SQLite |
| 生产数据库 | PostgreSQL，通过 `DATABASE_URL` 配置 |
| 图片处理依赖 | Pillow |
| 二维码生成 | qrcode |
| 数据库 URL 解析 | dj-database-url |
| PostgreSQL 驱动 | psycopg binary |
| 生产 WSGI | Gunicorn |
| 静态文件服务 | WhiteNoise |
| 管理后台美化 | django-simpleui |
| 目标部署平台 | Zeabur + Neon + Zeabur Volume |

### 1.4 目录结构

```text
E:\Memoirs
├── config/                         # Django 项目配置
│   ├── settings.py                  # 设置、环境变量、数据库、静态文件、安全配置
│   ├── urls.py                      # 全局 URL 路由
│   ├── context_processors.py        # 模板上下文处理器
│   ├── asgi.py
│   └── wsgi.py
├── memories/                        # 核心应用
│   ├── models.py                    # Memoir 与 MemoirMedia 模型
│   ├── views.py                     # 页面视图、详情、上传、删除、私有媒体读取
│   ├── forms.py                     # 注册表单与回忆表单
│   ├── urls.py                      # 应用路由
│   ├── admin.py                     # Admin 后台配置
│   ├── tests.py                     # 核心功能测试
│   ├── migrations/
│   │   ├── __init__.py
│   │   └── 0001_initial.py          # 初始数据库迁移
│   └── management/
│       └── commands/
│           └── ensure_superuser.py  # 部署时自动创建超级用户
├── templates/
│   ├── base.html                    # React 挂载壳、静态资源引用、初始 JSON 上下文
│   ├── registration/
│   │   ├── login.html               # 登录页标题壳
│   │   └── register.html            # 注册页标题壳
│   └── memories/
│       ├── memoir_list.html         # 回忆列表页标题壳
│       ├── memoir_detail.html       # 回忆详情页标题壳
│       ├── memoir_form.html         # 新增/编辑回忆页标题壳
│       └── mobile_upload.html       # 手机上传页标题壳
├── frontend/                        # React/Vite 前端源码
│   ├── package.json                 # 前端依赖与构建脚本
│   ├── vite.config.ts               # 输出到 static/frontend，且不清空目录
│   └── src/                         # React 组件、API helper、CSS 源码
├── static/
│   ├── frontend/app.css             # Django 页面引用的前端样式
│   ├── frontend/app.js              # Django 页面引用的前端脚本
│   └── images/                      # 登录背景与纸纹理等项目内视觉资产
├── media/                           # 本地上传文件目录，已被 .gitignore 忽略
├── .test-media/                     # 测试媒体目录，已被 .gitignore 忽略
├── .env.example                     # 环境变量示例
├── .gitignore                       # Git 忽略规则
├── environment.yml                  # Conda 环境定义
├── requirements.txt                 # pip 依赖
├── zbpack.json                      # Zeabur 构建/启动配置
├── manage.py                        # Django 管理入口
└── db.sqlite3                       # 本地 SQLite 数据库，已被 .gitignore 忽略
```

### 1.5 当前运行入口

本地启动入口：

```powershell
python manage.py runserver 127.0.0.1:8017
```

本地访问地址：

```text
http://127.0.0.1:8017/
```

后台地址：

```text
http://127.0.0.1:8017/admin/
```

生产启动命令由 `zbpack.json` 定义：

```sh
mkdir -p ${MEDIA_ROOT:-/data/media} && python manage.py migrate --noinput && python manage.py collectstatic --noinput && python manage.py ensure_superuser && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8080}
```

这条命令会依次完成：

1. 创建媒体目录。
2. 执行数据库迁移。
3. 收集静态文件。
4. 根据环境变量创建初始超级用户。
5. 用 Gunicorn 启动 Django WSGI 应用。

## 2. 前端说明

### 2.1 前端架构

用户可见前端已切换为 React 18 + Vite + TypeScript。Django Template 不再直接绘制完整页面，而是输出统一挂载壳、初始 JSON 上下文和静态资源引用。

当前前端边界：

- `#memoirs-root` 是 React 挂载节点。
- `memoirs-initial-data` 注入当前页面、登录态、CSRF token、路由和首屏数据。
- `session.uploadLimits` 注入当前上传大小限制，供前端在用户选择视频或照片时提前给出明确提示。
- `static/frontend/app.css` 与 `static/frontend/app.js` 是 Django 实际引用的前端产物。
- `templates/base.html` 引用前端产物时带固定版本参数；重做用户界面后应更新该参数，避免浏览器继续缓存旧 bundle。
- `frontend/src/` 是 React/Vite 源码。
- 由于本机环境可能没有 `npm`，仓库保留了轻量 `static/frontend/app.js` fallback；正式前端更新应运行 Vite 构建覆盖它。
- 移动端性能优先使用 `static/images/*.webp` 背景图，PNG 只作为 CSS fallback；时间线和详情页视频缩略图使用 `preload="metadata"` 与 `playsInline`，只取首帧元数据用于预览，不提前完整加载视频。

主要前端文件：

| 文件 | 作用 |
| --- | --- |
| `templates/base.html` | React 挂载壳、初始 JSON、静态资源引用和页面级 head 扩展位 |
| `templates/registration/login.html` | 登录页标题壳 |
| `templates/registration/register.html` | 注册页标题壳 |
| `templates/memories/memoir_list.html` | 回忆库标题壳和首批图片 head preload |
| `templates/memories/memoir_detail.html` | 回忆详情标题壳 |
| `templates/memories/memoir_form.html` | 新增/编辑标题壳 |
| `templates/memories/mobile_upload.html` | 手机上传标题壳 |
| `frontend/src/components/` | 登录/注册、回忆库、全站相册、详情页、编辑器、手机上传和媒体预览组件 |
| `frontend/src/lib/` | 初始上下文、CSRF、fetch API 和共享类型 |
| `frontend/src/styles/app.css` | 高端私人纪念册视觉系统源码 |
| `static/frontend/app.js` / `app.css` | Django 实际引用的前端产物 |

页面初始数据由后端视图注入；后续搜索、筛选、保存、删除、上传等交互优先通过 JSON API 完成。旧的 POST 页面视图仍保留为非 JS fallback 和测试兼容入口。

### 2.2 基础布局 `base.html`

`templates/base.html` 是 React 前端的统一挂载模板。

它负责：

- 加载静态资源标签 `{% load static %}`。
- 设置 HTML 语言为 `zh-CN`。
- 设置响应式视口。
- 暴露 `{% block head_extra %}` 给业务页面追加 head 资源提示。
- 引入样式文件：`static/frontend/app.css`。
- 静态前端资源 URL 带版本参数，用于强制浏览器刷新最新 React/CSS。
- 渲染 `#memoirs-root`。
- 通过 `json_script` 写入 `app_initial_data`。
- 在页面底部引入脚本：`static/frontend/app.js`。

导航区域、登录表单、回忆列表、编辑器和手机上传状态都由 React 根据初始 JSON 和 API 响应渲染。

### 2.2.1 React 页面与视觉方向

视觉方向固定为“纪念 TA 的高端私人回忆档案”：

- 登录和注册页的图标输入框由 `.input-wrap` 统一承载焦点态，内部 `input` 不再重复渲染 focus 阴影，避免点击用户名/密码框时出现双层边框。
- 回忆库时间线行点击后进入独立详情页，详情页展示完整普通文本正文和全部照片/视频。
- 心情筛选栏只来自当前用户真实填写过的 `mood` 值；没有心情数据时只显示“全部”，不再展示默认兜底心情标签。
- 新增/编辑回忆表单中，`mood` 前端输入使用常见心情下拉选项；正文 textarea 保持普通文本输入。
- 新增/编辑回忆表单在移动端隐藏 `.qr-card` 二维码上传入口和 `.phone-status-card` 上传状态卡片；桌面端继续显示，用于从手机扫码上传媒体。
- 页面文案使用“TA”“旧时光”“回忆”“私密保存”，不直接放大“前任”。
- 主色为深墨绿，辅以暖白纸感、古金和石墨色；删除/危险动作使用柔和珊瑚色。
- 回忆库页以左侧档案栏和时间线表格为主，不再使用营销型大 Hero 或泛卡片瀑布流。
- 登录页使用项目内背景图 `static/images/memoir-login-scene.png`。
- 全站纸感背景使用 `static/images/archive-paper-texture.png`。
- 圆角保持 8px 以内，避免营销型 hero、装饰光球、大面积蓝紫渐变和外链背景图。

### 2.2.2 JSON API

新增 API 路由位于 `memories/urls.py`：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/session/` | GET | 当前登录态、CSRF token、前端路由 |
| `/api/auth/login/` | POST | 登录 |
| `/api/auth/register/` | POST | 注册并登录 |
| `/api/auth/logout/` | POST | 退出 |
| `/api/memoirs/` | GET/POST | 列表/搜索/筛选，返回回忆、媒体、照片、视频和回收站统计，或创建回忆；`?deleted=1` 返回回收站 |
| `/api/memoirs/<uuid>/` | GET/POST | 读取编辑数据，或保存修改 |
| `/api/memoirs/<uuid>/delete/` | POST | 将回忆移入回收站 |
| `/api/memoirs/<uuid>/restore/` | POST | 从回收站恢复回忆 |
| `/api/memoirs/<uuid>/destroy/` | POST | 永久删除回忆并清理媒体文件 |
| `/api/mobile-upload-sessions/` | POST | 生成新增/编辑页手机上传二维码会话 |

手机上传 token 页面仍使用 `/mobile-upload/<token>/`。当请求头接受 JSON 时，它会返回 React 所需的上传状态和错误信息；普通表单 POST 仍可作为 fallback。

> 下面的页面小节保留业务流程说明；具体视觉和 DOM 已由 React 组件实现，不再由模板直接绘制完整页面。

### 2.3 登录页

文件：`templates/registration/login.html`

路由：

```text
/accounts/login/
```

视图来源：

```python
django.contrib.auth.views.LoginView
```

页面特点：

- 使用独立的 `{% block body %}`，不继承登录后页面导航。
- 采用沉浸式背景图与登录卡片布局。
- 展示品牌文案：`忆往昔`。
- 登录页主标题文案（React 登录态）：`回忆替TA陪我`。
- 表单字段来自 Django 内置认证表单。
- 提交后由 Django Auth 完成登录。
- 如果登录失败，显示 `用户名或密码不正确。`。
- 如果 `ALLOW_PUBLIC_REGISTRATION=True`，显示注册链接。

登录成功后的默认跳转由 `settings.py` 配置：

```python
LOGIN_REDIRECT_URL = "memoir_list"
```

### 2.4 注册页

文件：`templates/registration/register.html`

路由：

```text
/accounts/register/
```

对应视图：

```python
memories.views.register
```

注册表单：

```python
memories.forms.RegisterForm
```

页面特点：

- 使用和登录页一致的视觉结构。
- 字段包括用户名、邮箱、密码、确认密码。
- 邮箱为可选。
- 注册成功后自动登录。
- 注册成功后跳转到回忆列表页。

公开注册开关：

```python
ALLOW_PUBLIC_REGISTRATION = env_bool("ALLOW_PUBLIC_REGISTRATION", DEBUG)
```

当 `ALLOW_PUBLIC_REGISTRATION=False` 时：

- 访问注册页返回 404。
- 登录页不展示“立即注册”入口。

### 2.5 回忆列表页

文件：`templates/memories/memoir_list.html`

路由：

```text
/
/memoirs/
```

页面数据由 `memoir_list` 视图传入：

| 上下文变量 | 含义 |
| --- | --- |
| `memoirs` | 当前用户可见的回忆列表 |
| `query` | 当前搜索关键字 |
| `active_mood` | 当前选中的心情标签 |
| `mood_choices` | 当前用户已有的非空心情标签 |
| `memoir_count` | 当前用户回忆总数 |
| `media_count` | 当前用户媒体文件总数 |
| `media_preload_urls` | 当前列表前 8 张图片缩略图的受保护访问地址，用于 head preload |
| `stats.photos` / `stats.videos` | React API 统计中的图片和视频数量 |

页面结构：

- 左侧档案栏：品牌、`记忆中的TA`、时间线、地点、心情、信笺、媒体、回收站、设置和退出入口。
- 顶部工具栏：标题 `记忆中的TA`、回忆/照片/视频统计、搜索框、提醒头像和新增入口。
- 筛选工具栏：心情标签筛选、时间排序和列表视图按钮。
- 时间线区域：逐条展示紧凑档案行，不使用瀑布流或大卡片布局。
- 头像按钮打开账号浮层，退出需要在浮层或侧栏明确点击退出。
- 空状态：没有回忆时展示新增入口。
- 预览弹层：供 JavaScript 动态填充图片或视频。

列表页会在 head 中为当前列表前 8 张图片输出：

```html
<link rel="preload" as="image" href="..." fetchpriority="high">
```

对应 React 图片缩略图使用 `loading="eager"`、`decoding="async"` 和 `fetchPriority`，让浏览器在页面打开时尽早请求图片。视频仅给出元数据预加载和内联播放提示，不强制整段下载。

每条回忆行包含：

- 日期，未填写时显示 `某一天`。
- 最多两张图片/视频缩略图，点击打开媒体预览；媒体视图最多展示三张。
- 标题。
- 地点和心情标签。
- 正文摘要。
- 媒体数量、修改入口和删除按钮。
- 点击行主体进入回忆详情页；点击媒体缩略图仍打开预览弹层，点击修改/删除只执行对应操作。

删除回忆使用 POST 表单，并通过浏览器 `confirm` 弹窗二次确认：

```html
onsubmit="return confirm('确定删除这段回忆和它的媒体文件吗？');"
```

媒体缩略图按钮带有以下数据属性：

| 属性 | 用途 |
| --- | --- |
| `data-media-url` | 受保护媒体访问地址 |
| `data-media-type` | `image` 或 `video` |
| `data-media-name` | 原始文件名，用作预览标题或图片 alt |

这些属性现在由 React 的媒体预览组件读取，用来创建预览弹层内容；列表图片预热由 head preload 和 `MediaThumbnail` 的 eager/high priority 属性完成，旧 `static/js/app.js` 不再作为主入口引用。

### 2.6 回忆详情页

文件：`templates/memories/memoir_detail.html`

路由：

```text
/memoirs/<uuid>/
```

详情页由 `memoir_detail` 视图传入单条 `Memoir` 的序列化数据，React 渲染完整标题、日期、地点、心情、普通文本正文和全部照片/视频。媒体缩略图不显示文件名文字，点击后打开预览弹层，右侧整理区域提供编辑入口。

全站相册页由 `media_gallery` 视图传入当前账号全部未进入回收站的 `MemoirMedia`，React 渲染 `/memoirs/media/`。相册支持 `type=image|video`、`year=YYYY`、`location=<地点>` 查询参数；年份和日期分组使用所属回忆的 `memory_date`，无日期媒体放入“未记录日期”分组。相册格子只展示图片/视频本身和必要的视频播放图标，不展示标题、正文或文件名描述；点击媒体打开预览弹层，弹层可下载原文件或跳回所属回忆详情页。

### 2.7 新增/编辑回忆页

文件：`templates/memories/memoir_form.html`

新增路由：

```text
/memoirs/new/
```

编辑路由：

```text
/memoirs/<uuid>/edit/
```

同一模板通过 `mode` 区分新增和编辑：

| `mode` | 页面含义 |
| --- | --- |
| `create` | 新增回忆 |
| `edit` | 修改回忆 |

表单配置：

```html
<form class="form-panel memoir-editor" method="post" enctype="multipart/form-data">
```

必须使用 `enctype="multipart/form-data"`，否则媒体文件不会随请求上传。

表单字段：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `title` | `Memoir.title` | 标题，必填 |
| `memory_date` | `Memoir.memory_date` | 日期，可空 |
| `location` | `Memoir.location` | 地点，可空 |
| `mood` | `Memoir.mood` | 心情标签，可空 |
| `story` | `Memoir.story` | 正文，可空 |
| `media` | 原生 file input | 图片或视频，可多选 |
| `delete_media` | checkbox | 编辑时删除已有媒体 |

媒体上传控件：

```html
<input data-file-input type="file" name="media" accept="image/*,video/*" multiple>
```

说明：

- `name="media"` 与后端 `request.FILES.getlist("media")` 对应。
- 选择图片或视频后，React 编辑器会使用浏览器本地 `objectURL` 显示缩略预览。
- 手机扫码上传成功后，电脑端状态列表会通过受保护的临时预览接口显示缩略图。
- `accept="image/*,video/*"` 在浏览器层面引导用户选择图片或视频。
- `multiple` 允许一次选择多个文件。
- 实际文件类型仍由后端再次校验。

编辑页面的已有媒体区域：

- 展示当前回忆下已有的图片或视频。
- 每个媒体文件有一个 `delete_media` 复选框。
- 保存时，勾选的媒体记录会被删除。
- 删除媒体记录会触发模型信号，同步删除磁盘文件。

### 2.8 CSS 视觉系统

文件：`frontend/src/styles/app.css`，构建产物为 `static/frontend/app.css`

当前 CSS 是单文件全局样式，没有引入 CSS 框架。

主要设计特征：

- 中文界面。
- 私密档案感的浅色纸张背景。
- 主色为绿色/青绿色。
- 辅助色包含珊瑚色、金色、薰衣草色。
- 大量使用 8px 圆角。
- 表单和工具栏保持半透明面板；列表页改为低阴影的档案表格密度。
- 登录页使用全屏背景图和玻璃感登录卡片。
- 列表页使用左侧深墨绿档案栏和紧凑时间线表格。
- 媒体预览弹层使用深色背景。

重要 CSS 变量：

| 变量 | 用途 |
| --- | --- |
| `--ink` | 主文本颜色 |
| `--text` | 正文文本颜色 |
| `--muted` | 次级文本颜色 |
| `--line` | 边框颜色 |
| `--paper` | 页面背景色 |
| `--panel` | 面板背景色 |
| `--teal` | 主强调色 |
| `--teal-dark` | 深主色 |
| `--coral` | 危险操作色 |
| `--gold` | 日期、强调信息色 |
| `--shadow` | 常规阴影 |
| `--focus` | 焦点态阴影 |

主要样式模块：

- `.app-shell`：登录后页面容器。
- `.app-nav`：顶部导航。
- `.brand` / `.brand-mark`：品牌展示。
- `.button` / `.link-button` / `.danger-button`：按钮样式。
- `.hero` / `.archive-hero` / `.form-hero`：页面主视觉区。
- `.toolbar` / `.toolbar-form`：列表页搜索和筛选区域。
- `.memoir-card`：回忆卡片。
- `.media-grid` / `.media-tile`：媒体缩略图网格。
- `.form-panel` / `.memoir-editor`：新增/编辑表单。
- `.login-shell` / `.login-scene` / `.login-card`：登录注册页面。
- `.preview-backdrop` / `.preview-dialog`：媒体预览弹层。

### 2.9 响应式适配

CSS 里主要使用三个断点：

| 断点 | 用途 |
| --- | --- |
| `max-width: 1120px` | 工具栏从多列改为单列 |
| `max-width: 980px` | Hero、登录布局、统计卡改为更窄布局 |
| `max-width: 620px` | 手机端导航、卡片操作按钮、表单布局调整 |
| `max-width: 430px` | 媒体网格改为单列 |

手机端重点适配：

- 导航按钮变成网格布局。
- 回忆卡片头部从横排变为竖排。
- 修改/删除按钮占满可用宽度。
- 表单双列字段改为单列。
- 图片/视频缩略图从两列进一步降为单列。
- 登录卡片减少内边距。

### 2.10 JavaScript 交互

文件：`frontend/src/` 下的 React 组件，构建产物为 `static/frontend/app.js`

项目中的 JavaScript 只负责增强页面体验，不承载核心业务逻辑。即使 JavaScript 不运行，后端表单提交仍然可以保存数据。

#### 2.9.1 文件选择列表

JS 通过以下属性找到文件输入框和展示列表：

```html
data-file-input
data-file-list
```

流程：

1. 监听页面 `DOMContentLoaded`。
2. 查找文件输入框和文件列表容器。
3. 当文件选择变化时，清空旧列表。
4. 遍历 `fileInput.files`。
5. 为每个文件创建一个 `<li>`，显示文件名。

这只是前端提示，不代表上传成功。真正保存发生在后端表单 POST 处理阶段。

#### 2.9.2 媒体预览弹层

JS 通过以下属性找到预览区域：

| 属性 | 说明 |
| --- | --- |
| `data-preview` | 弹层遮罩 |
| `data-preview-dialog` | 图片/视频插入位置 |
| `data-preview-caption` | 文件名标题 |
| `data-preview-close` | 关闭按钮 |
| `data-media-url` | 缩略图按钮上的媒体地址 |
| `data-media-type` | 缩略图按钮上的媒体类型 |
| `data-media-name` | 缩略图按钮上的文件名 |

点击媒体缩略图后：

1. 读取媒体 URL、类型、文件名。
2. 如果类型是 `video`，创建带 `controls`、`autoplay`、`playsInline` 和 `preload` 的 `<video>`。
3. 否则创建 `<img>`。
4. 清空旧预览内容。
5. 插入新预览元素。
6. 更新标题。
7. 给遮罩添加 `open` class。

页面加载后，JS 还会把列表页图片保持为 eager 加载，并对视频调用轻量预热；如果视频自动播放被浏览器阻止，会保留控制条供用户手动播放。

关闭方式：

- 点击关闭按钮。
- 点击遮罩空白处。
- 按 `Escape` 键。

## 3. 后端说明

### 3.1 Django 项目配置

核心配置文件：`config/settings.py`

配置文件负责：

- 读取本地 `.env`。
- 解析布尔、列表和整数类型环境变量。
- 配置 Debug、Secret Key、Allowed Hosts、CSRF Trusted Origins。
- 根据 `DATABASE_URL` 选择 PostgreSQL 或 SQLite。
- 配置静态文件和媒体文件。
- 配置 WhiteNoise。
- 配置登录、退出和重定向。
- 配置上传大小限制。
- 配置生产安全项。
- 配置 SimpleUI 后台菜单。

#### 3.1.1 `.env` 加载

项目自带轻量级 `.env` 读取函数：

```python
def load_local_env() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
```

如果根目录存在 `.env`，配置会逐行读取 `KEY=value`，并写入 `os.environ`。如果环境变量已经存在，则不会覆盖。

注意：

- `.env` 不应该提交到 Git。
- `.env.example` 是可提交的示例文件。

#### 3.1.2 Debug 与 Secret Key

```python
DEBUG = env_bool("DEBUG", True)
SECRET_KEY = os.environ.get("SECRET_KEY")
```

规则：

- 本地 `DEBUG=True` 时，如果没有设置 `SECRET_KEY`，使用本地默认值。
- 生产 `DEBUG=False` 时，必须设置 `SECRET_KEY`。
- 如果生产未设置 `SECRET_KEY`，Django 会抛出 `ImproperlyConfigured`。

#### 3.1.3 Allowed Hosts 与 CSRF

```python
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "127.0.0.1,localhost")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
```

项目还会自动识别部署平台环境变量：

- `RENDER_EXTERNAL_HOSTNAME`
- `ZEABUR_WEB_DOMAIN`
- `ZEABUR_WEB_URL`

如果这些变量存在，项目会自动把对应域名加入：

- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`

### 3.2 已安装应用

```python
INSTALLED_APPS = [
    "simpleui",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "memories",
]
```

说明：

- `simpleui` 必须放在 `django.contrib.admin` 之前，以便接管 Admin 样式。
- `memories` 是项目唯一业务应用。

### 3.3 中间件

基础中间件包括：

- `SecurityMiddleware`
- `SessionMiddleware`
- `CommonMiddleware`
- `CsrfViewMiddleware`
- `AuthenticationMiddleware`
- `MessageMiddleware`
- `XFrameOptionsMiddleware`

如果安装了 WhiteNoise，会自动插入：

```python
whitenoise.middleware.WhiteNoiseMiddleware
```

插入位置在 `SecurityMiddleware` 之后，适合生产环境直接服务静态文件。

### 3.4 全局路由

文件：`config/urls.py`

| 路由 | 名称 | 处理方 | 说明 |
| --- | --- | --- | --- |
| `/admin/` | 无 | Django Admin | 后台管理 |
| `/accounts/login/` | `login` | `LoginView` | 登录 |
| `/accounts/register/` | `register` | `memories.views.register` | 注册 |
| `/accounts/logout/` | `logout` | `LogoutView` | 退出 |
| `/` | 应用 include | `memories.urls` | 回忆应用路由 |

后台标题：

```python
admin.site.site_header = "忆往昔"
admin.site.site_title = "忆往昔后台"
admin.site.index_title = "后台管理"
```

### 3.5 应用路由

文件：`memories/urls.py`

| 路由 | 名称 | 视图 | 方法 | 说明 |
| --- | --- | --- | --- | --- |
| `/` | `memoir_list` | `memoir_list` | GET | 回忆列表首页 |
| `/memoirs/` | `memoir_list_alt` | `memoir_list` | GET | 回忆列表备用路径 |
| `/memoirs/media/` | `media_gallery` | `media_gallery` | GET | 当前账号全站媒体相册；支持 `type`、`year`、`location` 筛选 |
| `/memoirs/new/` | `memoir_create` | `memoir_create` | GET/POST | 新增回忆 |
| `/memoirs/<uuid:pk>/` | `memoir_detail` | `memoir_detail` | GET | 回忆详情 |
| `/memoirs/<uuid:pk>/edit/` | `memoir_update` | `memoir_update` | GET/POST | 编辑回忆 |
| `/memoirs/<uuid:pk>/delete/` | `memoir_delete` | `memoir_delete` | POST | 将回忆移入回收站 |
| `/memoirs/<uuid:pk>/restore/` | `memoir_restore` | `memoir_restore` | POST | 从回收站恢复回忆 |
| `/memoirs/<uuid:pk>/destroy/` | `memoir_destroy` | `memoir_destroy` | POST | 永久删除回忆并清理媒体文件 |
| `/mobile-upload/<str:token>/` | `mobile_upload` | `mobile_upload` | GET/POST | 手机端限时上传页 |
| `/mobile-upload/<str:token>/status/` | `mobile_upload_status` | `mobile_upload_status` | GET | 电脑端轮询手机上传状态 |
| `/mobile-upload/<str:token>/items/<int:item_id>/preview/` | `mobile_upload_item_preview` | `mobile_upload_item_preview` | GET | 手机上传临时/已入库文件预览 |
| `/protected-media/<path:file_path>` | `protected_media` | `protected_media` | GET | 受保护媒体读取；`?download=1` 下载原文件 |
| `/protected-media-thumbnails/<int:media_id>/` | `protected_media_thumbnail` | `protected_media_thumbnail` | GET | 受保护图片 WebP 缩略图 |

除了登录、注册和后台外，核心回忆页面均要求登录。

### 3.6 表单

文件：`memories/forms.py`

#### 3.6.1 RegisterForm

继承：

```python
UserCreationForm
```

字段：

| 字段 | 说明 |
| --- | --- |
| `username` | 用户名 |
| `email` | 邮箱，可选 |
| `password1` | 密码 |
| `password2` | 确认密码 |

该表单自定义了中文 label 和 placeholder。

#### 3.6.2 MemoirForm

继承：

```python
forms.ModelForm
```

对应模型：

```python
Memoir
```

字段：

```python
fields = ("title", "memory_date", "location", "mood", "story")
```

说明：

- 媒体文件没有放在 `MemoirForm` 里。
- 媒体文件通过模板中的原生 `<input type="file" name="media">` 上传。
- 后端在视图里通过 `request.FILES.getlist("media")` 单独处理。

### 3.7 视图流程

文件：`memories/views.py`

#### 3.7.1 注册视图 `register`

流程：

1. 如果 `ALLOW_PUBLIC_REGISTRATION=False`，返回 404。
2. 如果当前用户已登录，重定向到回忆列表。
3. GET 请求渲染注册表单。
4. POST 请求校验表单。
5. 表单有效时创建用户。
6. 调用 `login(request, user)` 自动登录。
7. 写入成功消息。
8. 重定向到 `memoir_list`。

#### 3.7.2 上传分类 `classify_upload`

函数：

```python
def classify_upload(upload) -> tuple[str, str] | None:
```

识别依据：

- 浏览器上传提供的 `content_type`。
- 文件名后缀。

支持图片后缀：

```text
.apng .avif .gif .heic .jpeg .jpg .png .webp
```

支持视频后缀：

```text
.m4v .mov .mp4 .mpeg .webm
```

返回值：

- 图片：`(MemoirMedia.MediaType.IMAGE, mime_type)`
- 视频：`(MemoirMedia.MediaType.VIDEO, mime_type)`
- 不支持：`None`

不支持的文件类型会通过 `form.add_error(None, "...")` 添加非字段错误。

#### 3.7.3 上传收集 `collect_uploads`

函数：

```python
def collect_uploads(request: HttpRequest, form: MemoirForm) -> list[tuple[object, tuple[str, str]]]:
```

职责：

- 遍历 `request.FILES.getlist("media")`。
- 调用 `classify_upload`。
- 将合法文件加入列表。
- 将非法文件添加为表单错误。

#### 3.7.4 保存上传 `save_uploads`

函数：

```python
def save_uploads(memoir: Memoir, classified_uploads: list[tuple[object, tuple[str, str]]]) -> None:
```

职责：

- 为每个上传文件创建 `MemoirMedia` 记录。
- 写入文件、原始文件名、媒体类型、MIME 类型和文件大小。

#### 3.7.5 列表视图 `memoir_list`

装饰器：

```python
@login_required
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| `q` | 搜索关键字 |
| `mood` | 心情标签 |

数据权限：

```python
Memoir.objects.filter(owner=request.user)
```

搜索字段：

- `title`
- `story`
- `location`
- `mood`

搜索方式：

```python
icontains
```

列表性能优化：

```python
prefetch_related("media_items")
```

用于减少每条回忆读取媒体文件时的查询次数。

#### 3.7.6 新增视图 `memoir_create`

装饰器：

```python
@login_required
```

GET 请求：

- 创建空 `MemoirForm`。
- 渲染 `memoir_form.html`。
- 设置 `mode="create"`。

POST 请求：

1. 读取 `request.POST` 创建表单。
2. 调用 `collect_uploads` 分类媒体。
3. 表单有效时 `form.save(commit=False)`。
4. 设置 `memoir.owner = request.user`。
5. 保存 `Memoir`。
6. 调用 `save_uploads` 保存媒体。
7. 写入成功消息。
8. 重定向到列表页。

#### 3.7.7 编辑视图 `memoir_update`

装饰器：

```python
@login_required
```

权限控制：

```python
get_object_or_404(Memoir.objects.prefetch_related("media_items"), pk=pk, owner=request.user)
```

这保证普通用户只能编辑自己的回忆。

POST 请求流程：

1. 读取现有回忆。
2. 使用 `MemoirForm(request.POST, instance=memoir)`。
3. 分类新上传文件。
4. 读取 `delete_media` 列表。
5. 表单有效时进入事务。
6. 保存回忆字段。
7. 删除被勾选且属于当前回忆的媒体。
8. 保存新上传媒体。
9. 写入成功消息。
10. 重定向到列表页。

事务：

```python
with transaction.atomic():
```

该事务覆盖回忆字段更新、媒体记录删除和新增媒体记录创建。

#### 3.7.8 回收站视图 `memoir_delete` / `memoir_restore` / `memoir_destroy`

装饰器：

```python
@login_required
@require_POST
```

说明：

- 只能通过 POST 修改回收站状态。
- `memoir_delete` 只把当前用户自己的未删除回忆标记为 `deleted_at=timezone.now()`，媒体记录和磁盘文件都会保留。
- 默认回忆列表、搜索、详情、编辑、全站相册、统计和编辑模式手机上传都排除已删除回忆。
- `memoir_restore` 只允许恢复当前用户自己的已删除回忆，会把 `deleted_at` 清空。
- `memoir_destroy` 只允许永久删除当前用户自己的已删除回忆；这时才会删除 `Memoir`，级联删除 `MemoirMedia`，并由 `post_delete` 信号清理磁盘文件。

#### 3.7.9 私有媒体视图 `protected_media`

装饰器：

```python
@login_required
```

访问规则：

- 未登录用户会被重定向到登录页。
- 媒体所属回忆的 owner 可以访问。
- staff 用户可以访问。
- 其他用户返回 404。

安全检查：

```python
media_root = Path(settings.MEDIA_ROOT).resolve()
target = (media_root / media.file.name).resolve()
target.relative_to(media_root)
```

这段逻辑用于防止路径穿越，确保最终读取的文件位于 `MEDIA_ROOT` 内。

返回：

```python
file_response_with_range(request, target, content_type, download_name, as_attachment)
```

当前实现会为媒体响应添加私有缓存头和 `Accept-Ranges: bytes`。当浏览器发送单段 `Range` 请求时返回 `206 Partial Content` 和 `Content-Range`，非法范围返回 `416`；当 URL 带 `?download=1` 时使用原始文件名作为附件下载。

#### 3.7.10 私有图片缩略图视图 `protected_media_thumbnail`

装饰器：

```python
@login_required
```

访问规则与 `protected_media` 一致：owner 或 staff 可访问，其他用户返回 404。图片缩略图按需生成到 `MEDIA_ROOT/.thumbnails/`，格式为 WebP，生成失败时回退读取原图，保证页面仍能显示。

### 3.8 后台管理

文件：`memories/admin.py`

后台管理两个模型：

- `Memoir`
- `MemoirMedia`

#### 3.8.1 MemoirAdmin

列表字段：

```python
("title", "owner", "memory_date", "mood", "location", "media_count", "deleted_at", "created_at")
```

筛选字段：

```python
("deleted_at", "mood", "memory_date", "created_at", "updated_at")
```

搜索字段：

```python
("title", "story", "location", "mood", "owner__username")
```

只读字段：

```python
("id", "created_at", "updated_at")
```

内联媒体：

```python
inlines = (MemoirMediaInline,)
```

后台创建回忆时，如果没有设置 owner，会自动设为当前后台用户：

```python
if not obj.owner_id:
    obj.owner = request.user
```

#### 3.8.2 MemoirMediaAdmin

列表字段：

```python
("original_filename", "memoir", "media_type", "mime_type", "size", "uploaded_at")
```

筛选字段：

```python
("media_type", "uploaded_at")
```

搜索字段：

```python
("original_filename", "memoir__title", "mime_type")
```

后台预览：

- 图片显示 `<img>`。
- 视频显示 `<video controls>`。
- 链接使用 `protected_url`，因此仍走受保护媒体路由。

### 3.9 管理命令 `ensure_superuser`

文件：`memories/management/commands/ensure_superuser.py`

作用：

- 部署时根据环境变量创建初始超级用户。
- 如果环境变量缺失，则跳过。
- 如果同名用户已存在，则不修改。

使用的环境变量：

| 变量 | 说明 |
| --- | --- |
| `DJANGO_SUPERUSER_USERNAME` | 超级用户名 |
| `DJANGO_SUPERUSER_EMAIL` | 超级用户邮箱，可空 |
| `DJANGO_SUPERUSER_PASSWORD` | 超级用户密码 |

在 Zeabur 启动命令中自动执行：

```sh
python manage.py ensure_superuser
```

## 4. 数据库与存储

### 4.1 数据库选择逻辑

配置文件：`config/settings.py`

如果设置了 `DATABASE_URL`：

```python
DATABASES = {
    "default": dj_database_url.parse(
        database_url,
        conn_max_age=600,
        conn_health_checks=True,
    )
}
```

如果没有设置 `DATABASE_URL`：

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}
```

因此：

- 本地默认使用 SQLite。
- 生产推荐设置 `DATABASE_URL` 使用 PostgreSQL。

### 4.2 本地 SQLite

本地数据库文件：

```text
db.sqlite3
```

特点：

- 适合本地开发和个人单机使用。
- 文件位于项目根目录。
- 已被 `.gitignore` 忽略，不应提交。
- 如果删除该文件，本地数据会丢失，除非有备份。

初始化命令：

```powershell
python manage.py migrate
```

创建本地管理员：

```powershell
python manage.py createsuperuser
```

### 4.3 生产 PostgreSQL

生产环境通过 `DATABASE_URL` 使用 PostgreSQL。当前部署方案推荐 Neon。

典型连接串形态：

```text
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

注意：

- Neon 连接串通常需要 `sslmode=require`。
- 不要把生产数据库连接串写入 Git。
- 在 Zeabur 环境变量中配置 `DATABASE_URL`。
- 生产迁移由 `zbpack.json` 启动命令自动执行。

### 4.4 模型关系

项目核心模型有两个：

```text
User 1 ─── N Memoir 1 ─── N MemoirMedia
```

说明：

- 一个用户可以拥有多条回忆。
- 一条回忆只能属于一个用户。
- 一条回忆可以有多个媒体文件。
- 一个媒体文件只能属于一条回忆。

### 4.5 Memoir 表

模型：`memories.models.Memoir`

含义：一条回忆记录。

| 字段 | 类型 | 约束/默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `UUIDField` | primary key，默认 `uuid.uuid4`，不可编辑 | 回忆唯一 ID |
| `title` | `CharField(max_length=120)` | 必填 | 标题 |
| `story` | `TextField` | `blank=True` | 正文 |
| `memory_date` | `DateField` | `blank=True, null=True` | 回忆日期 |
| `location` | `CharField(max_length=120)` | `blank=True` | 地点 |
| `mood` | `CharField(max_length=60)` | `blank=True` | 心情标签 |
| `owner` | `ForeignKey(settings.AUTH_USER_MODEL)` | `on_delete=CASCADE` | 所属用户 |
| `deleted_at` | `DateTimeField` | `blank=True, null=True` | 回收站删除时间；为空表示正常显示 |
| `created_at` | `DateTimeField` | `auto_now_add=True` | 创建时间 |
| `updated_at` | `DateTimeField` | `auto_now=True` | 更新时间 |

模型元信息：

```python
ordering = ["-memory_date", "-created_at"]
verbose_name = "回忆"
verbose_name_plural = "回忆"
```

排序规则：

1. 按 `memory_date` 倒序。
2. 日期相同时按 `created_at` 倒序。

### 4.6 MemoirMedia 表

模型：`memories.models.MemoirMedia`

含义：一条回忆关联的一个媒体文件。

| 字段 | 类型 | 约束/默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `BigAutoField` | primary key | 媒体记录 ID |
| `memoir` | `ForeignKey(Memoir)` | `related_name="media_items"`，`on_delete=CASCADE` | 所属回忆 |
| `file` | `FileField` | `upload_to=memoir_media_upload_to`，`max_length=500` | 文件路径 |
| `original_filename` | `CharField(max_length=255)` | `blank=True` | 原始文件名 |
| `media_type` | `CharField(max_length=10)` | choices: `image`/`video` | 媒体类型 |
| `mime_type` | `CharField(max_length=120)` | `blank=True` | MIME 类型 |
| `size` | `PositiveBigIntegerField` | 默认 `0` | 文件大小，单位字节 |
| `uploaded_at` | `DateTimeField` | `auto_now_add=True` | 上传时间 |

媒体类型枚举：

| 值 | 中文 |
| --- | --- |
| `image` | 图片 |
| `video` | 视频 |

模型元信息：

```python
ordering = ["uploaded_at", "id"]
verbose_name = "媒体文件"
verbose_name_plural = "媒体文件"
```

### 4.7 媒体文件路径规则

上传路径函数：

```python
def memoir_media_upload_to(instance: "MemoirMedia", filename: str) -> str:
    safe_name = get_valid_filename(Path(filename).name) or "memory"
    memoir_id = instance.memoir_id or uuid.uuid4()
    return f"memoirs/{memoir_id}/{uuid.uuid4().hex}-{safe_name}"
```

最终路径形态：

```text
memoirs/<memoir_id>/<uuid>-<safe_filename>
```

示例：

```text
memoirs/8d46f6f5-2bb7-42e7-94f3-66e7f8b24e8a/91af...-photo.jpg
```

实际磁盘路径为：

```text
<MEDIA_ROOT>/memoirs/<memoir_id>/<uuid>-<safe_filename>
```

本地默认：

```text
E:\Memoirs\media\memoirs\<memoir_id>\<uuid>-<safe_filename>
```

生产推荐：

```text
/data/media/memoirs/<memoir_id>/<uuid>-<safe_filename>
```

### 4.8 媒体记录保存逻辑

`MemoirMedia.save()` 会在保存前补全文件元数据：

- 从文件名推断 MIME 类型。
- 保存原始文件名。
- 保存文件大小。
- 如果没有显式设置 `media_type`，根据 MIME 类型或后缀判断图片/视频。

注意：

- 视图层已经先做了一次类型校验。
- 模型层的判断是补充保护和后台保存时的兜底。

### 4.9 回收站、级联删除与文件清理

模型关系：

```python
MemoirMedia.memoir = ForeignKey(Memoir, on_delete=models.CASCADE)
```

移入回收站时：

1. `Memoir.deleted_at` 写入当前时间。
2. `Memoir`、`MemoirMedia` 和磁盘文件都保留，用于后续恢复。
3. 默认列表、详情、编辑、相册和统计不再包含该回忆。

永久删除回忆时：

1. Django 删除 `Memoir`。
2. 级联删除关联的 `MemoirMedia`。
3. `MemoirMedia` 的 `post_delete` 信号触发。
4. 调用 `instance.file.delete(save=False)` 删除磁盘文件。

信号：

```python
@receiver(post_delete, sender=MemoirMedia)
def delete_media_file(sender, instance: MemoirMedia, **kwargs) -> None:
    if instance.file:
        instance.file.delete(save=False)
```

维护注意：

- 不要绕过模型直接删除数据库记录，否则可能留下孤儿文件。
- 不要直接公开 `media/` 目录，否则会绕开权限校验。
- 涉及文件删除逻辑时，要同时考虑数据库记录和磁盘文件。

### 4.10 数据库迁移

当前初始迁移文件：

```text
memories/migrations/0001_initial.py
```

该迁移创建：

- `Memoir`
- `MemoirMedia`

常用命令：

```powershell
python manage.py makemigrations
python manage.py migrate
```

如果修改模型字段，需要：

1. 修改 `models.py`。
2. 运行 `makemigrations` 生成迁移。
3. 检查迁移文件是否符合预期。
4. 本地运行 `migrate`。
5. 更新测试。
6. 部署后让启动命令自动执行迁移，或手动执行迁移。

## 5. 配置与环境变量

### 5.1 `.env.example`

当前示例：

```env
SECRET_KEY=replace-this-before-public-deploy
DEBUG=True
ALLOWED_HOSTS=127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=
ALLOW_PUBLIC_REGISTRATION=True

# Zeabur/Neon production settings
DATABASE_URL=
MEDIA_ROOT=
ZEABUR_WEB_DOMAIN=
ZEABUR_WEB_URL=

# Optional one-time superuser bootstrap for deployment builds
DJANGO_SUPERUSER_USERNAME=
DJANGO_SUPERUSER_EMAIL=
DJANGO_SUPERUSER_PASSWORD=
```

### 5.2 环境变量说明

| 变量 | 本地默认 | 生产建议 | 说明 |
| --- | --- | --- | --- |
| `SECRET_KEY` | Debug 下可省略 | 必填 | Django 加密签名密钥 |
| `DEBUG` | `True` | `False` | 是否开启调试 |
| `ALLOWED_HOSTS` | `127.0.0.1,localhost` | 生产域名 | 允许访问的 Host |
| `CSRF_TRUSTED_ORIGINS` | 空 | `https://你的域名` | 可信 CSRF 来源 |
| `ALLOW_PUBLIC_REGISTRATION` | 等于 `DEBUG` | 推荐 `False` | 是否允许公开注册 |
| `DATABASE_URL` | 空 | Neon PostgreSQL URL | 配置后使用 PostgreSQL |
| `MEDIA_ROOT` | `BASE_DIR / "media"` | `/data/media` | 上传文件保存目录 |
| `ZEABUR_WEB_DOMAIN` | 空 | Zeabur 自动或手动设置 | 自动加入 Host/CSRF |
| `ZEABUR_WEB_URL` | 空 | Zeabur 自动或手动设置 | 自动加入 Host/CSRF |
| `DJANGO_SUPERUSER_USERNAME` | 空 | 首次部署可填 | 自动创建管理员 |
| `DJANGO_SUPERUSER_EMAIL` | 空 | 可选 | 管理员邮箱 |
| `DJANGO_SUPERUSER_PASSWORD` | 空 | 首次部署可填 | 管理员密码 |
| `SECURE_SSL_REDIRECT` | `False` | `True` | 强制 HTTPS |
| `SESSION_COOKIE_SECURE` | `False` | `True` | Session Cookie 仅 HTTPS |
| `CSRF_COOKIE_SECURE` | `False` | `True` | CSRF Cookie 仅 HTTPS |
| `SECURE_HSTS_SECONDS` | `0` | `31536000` | HSTS 有效时间 |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `False` | 按域名策略决定 | HSTS 是否包含子域名 |
| `SECURE_HSTS_PRELOAD` | `False` | 谨慎开启 | 是否允许 HSTS preload |

### 5.3 上传大小限制

配置：

```python
FILE_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024 * 1024
MOBILE_UPLOAD_SESSION_TTL_MINUTES = 30
```

说明：

- 单个内存上传阈值为 20MB。
- 请求体最大为 1GB。
- 手机扫码上传链接默认有效期为 30 分钟。
- 生产平台本身可能还有额外请求大小限制，需要以平台实际限制为准。

### 5.4 静态文件配置

配置：

```python
STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
```

本地：

- Django 开发服务器直接读取 `static/`。

生产：

- `python manage.py collectstatic --noinput` 收集到 `staticfiles/`。
- WhiteNoise 服务静态文件。
- `staticfiles/` 已被 `.gitignore` 忽略，不应提交。

### 5.5 媒体文件配置

配置：

```python
MEDIA_URL = "/media/"
media_root = os.environ.get("MEDIA_ROOT", "").strip()
MEDIA_ROOT = Path(media_root) if media_root else BASE_DIR / "media"
```

注意：

- 虽然配置了 `MEDIA_URL`，项目并没有把 `media/` 直接暴露给公网。
- 用户访问媒体时使用 `protected_media` 视图。
- 生产必须把 `MEDIA_ROOT` 指向持久化存储，例如 `/data/media`。

## 6. 本地开发

### 6.1 使用 Conda 创建环境

```powershell
conda env create -f environment.yml
conda activate memoirs
```

如果环境已存在：

```powershell
conda activate memoirs
pip install -r requirements.txt
```

### 6.2 使用 pip 安装依赖

```powershell
pip install -r requirements.txt
```

依赖文件：`requirements.txt`

```text
Django>=5.0,<6.0
Pillow>=10.0
dj-database-url>=2.2
django-simpleui>=2026.1
gunicorn>=22.0
psycopg[binary]>=3.2
whitenoise>=6.7
```

### 6.3 初始化数据库

```powershell
python manage.py migrate
```

### 6.4 创建管理员

```powershell
python manage.py createsuperuser
```

### 6.5 启动服务

```powershell
python manage.py runserver 127.0.0.1:8017
```

访问：

```text
http://127.0.0.1:8017/
```

后台：

```text
http://127.0.0.1:8017/admin/
```

### 6.6 构建 React 前端

前端依赖和构建脚本在 `frontend/package.json`。构建产物输出到 `static/frontend/`，并配置为不清空输出目录。

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

如果 `memoirs` conda 环境中没有 `npm`，先安装 Node.js/npm：

```powershell
conda install -n memoirs "nodejs>=22"
```

### 6.7 本地 `.env` 示例

可以从 `.env.example` 复制为 `.env`，本地最小配置示例：

```env
SECRET_KEY=local-dev-secret
DEBUG=True
ALLOWED_HOSTS=127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=
ALLOW_PUBLIC_REGISTRATION=True
```

本地也可以不创建 `.env`，项目会使用默认值运行。

## 7. 部署说明

### 7.1 推荐部署架构

推荐组合：

```text
Zeabur Web Service
├── Django + Gunicorn
├── WhiteNoise 静态文件
├── Zeabur Volume: /data/media
└── Neon PostgreSQL
```

部署目标：

- Web 服务运行 Django。
- Neon 保存结构化数据。
- Zeabur Volume 保存上传图片和视频。
- 不使用本地 `db.sqlite3`。
- 不把 `media/` 打包为代码仓库内容。

### 7.2 Zeabur 启动配置

文件：`zbpack.json`

```json
{
  "python": {
    "version": "3.12",
    "entry": "manage.py",
    "package_manager": "pip"
  },
  "start_command": "mkdir -p ${MEDIA_ROOT:-/data/media} && python manage.py migrate --noinput && python manage.py collectstatic --noinput && python manage.py ensure_superuser && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8080}"
}
```

关键点：

- Python 版本固定为 3.12。
- 包管理器使用 pip。
- 启动前创建媒体目录。
- 启动时自动迁移数据库。
- 启动时收集静态文件。
- 启动时尝试创建超级用户。
- 最终由 Gunicorn 监听平台提供的 `PORT`。

### 7.3 Neon 数据库

部署步骤：

1. 在 Neon 创建 PostgreSQL 项目。
2. 选择离用户较近的区域，例如 Singapore。
3. 复制连接串。
4. 确认连接串包含 `sslmode=require`。
5. 在 Zeabur 服务环境变量中设置 `DATABASE_URL`。

示例：

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

不要提交该值到 Git。

### 7.4 Zeabur Volume

生产上传文件必须使用持久化 Volume。

建议：

1. 在 Zeabur 服务中添加 Volume。
2. Mount Directory 设置为：

```text
/data
```

3. 设置环境变量：

```env
MEDIA_ROOT=/data/media
```

启动命令会确保 `/data/media` 存在。

### 7.5 Zeabur 环境变量建议

生产建议：

```env
DEBUG=False
SECRET_KEY=<足够长的随机字符串>
DATABASE_URL=<Neon PostgreSQL 连接串>
MEDIA_ROOT=/data/media
ALLOW_PUBLIC_REGISTRATION=False
DJANGO_SUPERUSER_USERNAME=<管理员用户名>
DJANGO_SUPERUSER_EMAIL=<管理员邮箱>
DJANGO_SUPERUSER_PASSWORD=<管理员密码>
```

如果 Zeabur 没有自动注入域名变量，可以手动设置：

```env
ALLOWED_HOSTS=<你的域名>
CSRF_TRUSTED_ORIGINS=https://<你的域名>
```

如果使用 Zeabur 提供的变量：

```env
ZEABUR_WEB_DOMAIN=<域名>
ZEABUR_WEB_URL=https://<域名>
```

项目会自动加入 Allowed Hosts 和 CSRF Trusted Origins。

### 7.6 生产安全配置

当 `DEBUG=False` 时，默认安全项：

```python
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0 if DEBUG else 31536000)
```

生产含义：

- 默认强制 HTTPS。
- Session Cookie 默认只通过 HTTPS 发送。
- CSRF Cookie 默认只通过 HTTPS 发送。
- 默认开启 31536000 秒 HSTS。

如果部署平台的 HTTPS 代理配置特殊，需要确认：

```python
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
```

Zeabur 这类平台通常会通过反向代理传递 HTTPS 信息。

### 7.7 首次部署后检查

首次部署完成后建议检查：

1. 打开 Zeabur 分配的域名。
2. 确认没有 DisallowedHost 错误。
3. 确认登录页能打开。
4. 使用自动创建的超级用户登录 `/admin/`。
5. 创建或检查普通用户。
6. 新增一条回忆。
7. 上传一张图片和一个视频。
8. 刷新页面确认媒体仍可访问。
9. 重启服务后再次确认媒体仍存在。

如果重启后媒体消失，通常说明 `MEDIA_ROOT` 没有指向持久化 Volume。

## 8. 测试与验证

### 8.1 Django 检查

```powershell
python manage.py check
```

用于检查配置、URL、模型和常见 Django 问题。

### 8.2 自动测试

```powershell
python manage.py test
```

当前测试文件：

```text
memories/tests.py
```

测试覆盖：

- 核心页面需要登录。
- 登录页根据配置显示注册链接。
- 公开注册可关闭。
- 注册成功后自动登录。
- 创建回忆并上传媒体。
- 列表页显示修改入口。
- 列表页媒体输出 eager/high priority 图片属性、首批图片 preload 和视频预加载属性。
- 编辑回忆时修改字段、删除旧媒体、追加新媒体。
- 普通删除回忆时只进入回收站并保留媒体文件，永久删除时清理媒体文件。
- 受保护媒体只允许 owner 或 staff 访问。
- 全站相册只返回当前用户且未进入回收站的媒体，并支持照片/视频、回忆年份、地点筛选。
- 受保护媒体支持原文件下载、合法 Range 返回 206、非法 Range 返回 416。
- 受保护图片缩略图接口延续 owner/staff 权限控制。

测试媒体目录：

```text
.test-media/
```

该目录已被 `.gitignore` 忽略。

### 8.3 手工验收清单

本地验收建议：

1. 启动服务。
2. 注册新账号。
3. 新增回忆，只填标题。
4. 新增回忆，填写日期、地点、心情、正文。
5. 上传图片。
6. 上传视频。
7. 在新增/编辑回忆页扫码，用手机上传图片或视频，并确认电脑端出现缩略预览。
8. 新增回忆时确认手机上传文件会在电脑保存后加入回忆；编辑回忆时确认手机上传会立即加入回忆。
9. 使用搜索框搜索标题、正文、地点、心情。
10. 点击心情标签筛选。
11. 点击图片缩略图打开预览。
12. 点击视频缩略图播放视频。
13. 编辑回忆并追加媒体。
14. 编辑回忆并删除已有媒体。
15. 删除回忆，确认列表不再显示。
16. 用另一个账号访问原账号媒体链接，确认返回 404。
17. 用管理员访问媒体链接，确认可以访问。

## 9. 常用命令

### 9.1 环境与依赖

```powershell
conda env create -f environment.yml
conda activate memoirs
pip install -r requirements.txt
```

### 9.2 数据库

```powershell
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
```

### 9.3 本地运行

```powershell
python manage.py runserver 127.0.0.1:8017
```

### 9.4 静态文件

```powershell
python manage.py collectstatic --noinput
```

### 9.5 测试

```powershell
python manage.py check
python manage.py test
```

### 9.6 部署超级用户初始化

```powershell
python manage.py ensure_superuser
```

该命令依赖：

```env
DJANGO_SUPERUSER_USERNAME=
DJANGO_SUPERUSER_EMAIL=
DJANGO_SUPERUSER_PASSWORD=
```

## 10. Git 与文件提交规则

### 10.1 不应提交的文件

`.gitignore` 已忽略：

```text
.env
.env.*
!.env.example
db.sqlite3
*.sqlite3
media/
staticfiles/
.test-media/
*.log
.venv/
```

不要提交：

- 本地数据库。
- 生产数据库连接串。
- 用户上传媒体。
- 本地 `.env`。
- 日志。
- 虚拟环境。
- 测试媒体文件。
- `collectstatic` 生成的 `staticfiles/`。

### 10.2 应提交的文件

通常应该提交：

- `config/`
- `memories/`
- `templates/`
- `static/`
- `requirements.txt`
- `environment.yml`
- `.env.example`
- `zbpack.json`
- 项目文档。

## 11. 故障排查

### 11.1 访问生产域名出现 DisallowedHost

原因：

- 当前域名不在 `ALLOWED_HOSTS`。

处理：

```env
ALLOWED_HOSTS=你的域名
```

或者配置：

```env
ZEABUR_WEB_DOMAIN=你的域名
ZEABUR_WEB_URL=https://你的域名
```

### 11.2 POST 表单出现 CSRF 验证失败

原因：

- 生产域名没有加入 `CSRF_TRUSTED_ORIGINS`。
- HTTPS 代理头配置异常。

处理：

```env
CSRF_TRUSTED_ORIGINS=https://你的域名
```

并确认平台正确传递：

```text
X-Forwarded-Proto: https
```

### 11.3 生产环境启动时报 SECRET_KEY 错误

原因：

- `DEBUG=False` 时没有设置 `SECRET_KEY`。

处理：

```env
SECRET_KEY=足够长的随机字符串
```

### 11.4 上传后媒体无法访问

可能原因：

- 文件没有保存到 `MEDIA_ROOT`。
- `MEDIA_ROOT` 指向了非持久化目录。
- 数据库记录存在，但磁盘文件丢失。
- 当前用户不是媒体 owner 或 staff。

排查：

1. 检查 `MEDIA_ROOT`。
2. 检查 Zeabur Volume 是否挂载到 `/data`。
3. 检查媒体文件是否存在于 `/data/media`。
4. 检查访问用户是否为 owner 或 staff。

### 11.5 重启后上传文件消失

原因：

- 生产环境没有使用持久化 Volume。
- `MEDIA_ROOT` 没有配置到 Volume 路径。

处理：

```env
MEDIA_ROOT=/data/media
```

并确保 Zeabur Volume 挂载目录为：

```text
/data
```

### 11.6 公开注册入口不显示

原因：

```env
ALLOW_PUBLIC_REGISTRATION=False
```

处理：

- 如果希望开放注册，设置为 `True`。
- 如果是生产私密应用，保持 `False` 是推荐行为。

### 11.7 静态文件样式不生效

可能原因：

- 未执行 `collectstatic`。
- WhiteNoise 未安装。
- `STATIC_ROOT` 内容为空。

处理：

```powershell
python manage.py collectstatic --noinput
```

确认依赖中包含：

```text
whitenoise>=6.7
```

### 11.8 数据库迁移失败

排查：

1. 检查 `DATABASE_URL` 是否正确。
2. 确认 PostgreSQL 连接串含 `sslmode=require`。
3. 本地运行：

```powershell
python manage.py migrate
```

4. 如果是生产环境，查看 Zeabur 启动日志中 `migrate` 的错误。

## 12. 安全与隐私注意事项

### 12.1 不要公开 `media/` 目录

当前项目的隐私模型依赖 `protected_media` 视图：

- 先查数据库记录。
- 再校验访问者身份。
- 再确认文件路径位于 `MEDIA_ROOT` 内。
- 最后返回文件流。

如果把 `media/` 作为静态目录直接暴露，会绕过 owner/staff 权限校验，导致用户上传的图片和视频被公开访问。

### 12.2 不要提交本地数据

以下文件可能含有私人数据或密钥：

- `db.sqlite3`
- `media/`
- `.env`
- 日志文件

这些文件已经被 `.gitignore` 忽略，应继续保持不提交。

### 12.3 生产关闭公开注册

生产建议：

```env
ALLOW_PUBLIC_REGISTRATION=False
```

然后通过后台或管理命令创建需要的用户。

### 12.4 管理员密码

如果使用 `ensure_superuser` 创建初始管理员：

- 首次部署后建议登录后台修改密码。
- 或在创建完成后从平台环境变量中移除 `DJANGO_SUPERUSER_PASSWORD`。
- 命令不会修改已存在用户，避免重复部署覆盖密码。

## 13. 维护建议

### 13.1 新增媒体类型

如果要支持新的图片或视频格式，需要同步修改：

- `memories/models.py` 中的 `IMAGE_EXTENSIONS` 或 `VIDEO_EXTENSIONS`。
- `memories/views.py` 中的 `IMAGE_EXTENSIONS` 或 `VIDEO_EXTENSIONS`。
- 前端 `<input accept="image/*,video/*">` 是否需要调整。
- 测试用例是否覆盖新格式。

### 13.2 修改回忆字段

如果要新增或修改 `Memoir` 字段，需要同步检查：

- `memories/models.py`
- `memories/forms.py`
- `templates/memories/memoir_form.html`
- `templates/memories/memoir_list.html`
- `memories/admin.py`
- `memories/tests.py`
- 迁移文件

### 13.3 修改权限模型

当前权限模型简单明确：

- 普通用户只能访问自己的回忆和媒体。
- staff 可以访问媒体。
- Admin 可以管理后台数据。

如果后续增加共享、公开链接、家庭成员协作等功能，需要重新设计：

- 数据库权限关系。
- 查询过滤条件。
- 媒体访问规则。
- 测试覆盖。

### 13.4 后续可扩展方向

适合在当前项目基础上继续扩展：

- 分页。
- 批量导入/导出。
- 媒体压缩和缩略图。
- 更完善的标签体系。
- 按年份/月度归档。
- 收藏或置顶。
- 详情页评论、置顶或更多排版能力。
- 富文本编辑。
- 数据备份导出。
- 对象存储替代本地 Volume。
- 更细粒度的权限系统。

## 14. 当前项目状态总结

当前项目已经形成完整的私人回忆管理闭环：

- Django 模板负责页面渲染。
- 原生 CSS 和 JS 提供视觉与基础交互。
- Django Auth 提供登录、退出、注册。
- `Memoir` 保存回忆文本与元信息。
- `MemoirMedia` 保存图片/视频文件元数据。
- 上传文件保存到 `MEDIA_ROOT`。
- 媒体访问通过受保护视图控制。
- 本地默认 SQLite。
- 生产可通过 Neon PostgreSQL + Zeabur Volume 部署。
- Zeabur 启动命令覆盖迁移、静态文件收集、管理员初始化和 Gunicorn 启动。

维护这个项目时，最重要的原则是：

1. 不要公开 `media/`。
2. 不要提交本地数据和密钥。
3. 修改模型后同步更新表单、模板、后台、测试和迁移。
4. 生产环境使用 PostgreSQL 和持久化媒体目录。
5. 对任何涉及文件删除的改动，都要同时验证数据库记录和磁盘文件的清理行为。
