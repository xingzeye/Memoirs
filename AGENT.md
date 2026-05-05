# 项目认知备忘

## 最近功能变更：React/Vite 全流程前端

- 2026-05-05：修正登录/注册页用户名、邮箱和密码图标输入框的 focus 样式，点击后只显示外层高亮，不再出现内部重复描边。
- 2026-05-05：回忆库时间线行支持点击展开正文详情，正文按安全 Markdown 渲染；心情筛选只显示真实填写过的心情，不再使用默认兜底标签。
- 2026-05-05：新增/编辑回忆表单的心情字段改为常见选项下拉选择，正文编辑区增加 Markdown 工具栏和安全预览。
- 2026-05-05：新增/编辑回忆表单在移动端隐藏手机扫码上传二维码和上传状态卡片，桌面端保留。
- 用户可见页面已切换为 React/Vite 前端体验层，Django Template 现在主要负责输出 `#memoirs-root` 和初始 JSON 上下文。
- React 源码位于 `frontend/`，构建产物输出到 `static/frontend/app.js` 与 `static/frontend/app.css`。
- 当前视觉方向是“纪念 TA 的高端私人回忆档案”：文案使用“TA”“旧时光”“回忆”“私密保存”，不要在 UI 中直接放大“前任”。
- 回忆库首页已按参考图改为左侧深墨绿档案栏、顶部搜索筛选和紧凑时间线行；不要再改回营销型 Hero 或瀑布流卡片。
- 侧栏、时间排序、视图按钮和头像都应保持真实交互；头像只打开账号菜单，不能直接退出。
- 时间线视图只显示填写了回忆日期的条目；未写日期的回忆保留在全部列表。
- 时间线行只展示真实媒体缩略图，不为缺失媒体显示空占位框。
- `/api/memoirs/` 的统计包含 `memoirs`、`media`、`photos`、`videos`，没有信笺模型时不要虚构信笺数量。
- 新增 Django JSON API：认证、会话、回忆列表/创建/编辑/删除、手机上传会话。
- `templates/base.html` 给 `static/frontend/app.js` 和 `app.css` 带前端版本参数；更新前端界面后同步 bump，避免浏览器缓存旧界面。
- 项目内视觉资产位于 `static/images/`，不要重新引入远程 Unsplash 等外链背景图。
- 由于本机当前 PATH/conda 环境可能没有 `npm`，前端构建前需要先安装或启用 npm；后端验证使用 `conda run -n memoirs python ...`。
- `static/frontend/app.js` 保留轻量 fallback，正式更新前端后应运行 Vite 构建覆盖它。

## 最近功能变更：手机扫码上传

- 新增/编辑回忆页支持电脑端显示二维码，手机扫码后可免登录限时上传相册照片或视频。
- 新增回忆时，手机上传文件先保存为 `MobileUploadItem` 临时项，电脑端保存回忆后再转为正式 `MemoirMedia`。
- 编辑回忆时，手机上传成功后立即创建正式 `MemoirMedia`。
- 手机上传状态通过 `/mobile-upload/<token>/status/` 轮询，电脑端会展示文件名、大小和缩略图。
- 临时预览走 `/mobile-upload/<token>/items/<item_id>/preview/`，只允许 session 所属登录用户访问。
- 过期临时上传可用 `python manage.py cleanup_mobile_uploads` 清理。
- 依赖 `qrcode[pil]` 用于生成二维码，上传链接有效期由 `MOBILE_UPLOAD_SESSION_TTL_MINUTES` 控制，默认 30 分钟。
- 修改代码时，同步更新 `PROJECT_GUIDE.md`、`README.md` 和 `AGENT.md`。

## 项目概览

这是一个名为「前任回忆录」的本地优先 Django 私人回忆库。项目目标是让登录用户保存、浏览、搜索、编辑和删除自己的回忆条目，并为每条回忆附加照片或视频。

项目强调本地私密使用：

- 默认使用 SQLite 数据库 `db.sqlite3`。
- 上传文件默认保存在 `media/`。
- 项目可在没有 `.env` 的情况下直接运行。
- 通过登录保护回忆列表、创建、编辑、删除和媒体访问。

## 技术栈

- Python 3.12
- Django 5.x
- Pillow
- django-jazzmin，用于美化 Django Admin
- Django 模板系统
- React 18 + Vite + TypeScript 用户前端
- Django 模板系统作为 React 挂载壳
- 原生 CSS 设计系统和少量 fallback JavaScript
- qrcode，用于生成手机扫码上传入口二维码
- SQLite 作为默认数据库

依赖定义在：

- `requirements.txt`
- `environment.yml`

## 目录结构

```text
.
├── config/                  # Django 项目配置
│   ├── settings.py          # 设置、环境变量、静态/媒体文件、Jazzmin 配置
│   ├── urls.py              # 全局路由
│   ├── asgi.py
│   └── wsgi.py
├── memories/                # 核心应用
│   ├── models.py            # Memoir 与 MemoirMedia 模型
│   ├── views.py             # 列表、创建、编辑、删除、手机上传、受保护媒体访问
│   ├── forms.py             # MemoirForm
│   ├── urls.py              # 应用路由
│   ├── admin.py             # 后台管理配置
│   ├── tests.py             # 核心功能测试
│   └── migrations/
├── templates/
│   ├── base.html
│   ├── registration/login.html
│   └── memories/
│       ├── memoir_list.html
│       └── memoir_form.html
├── frontend/                # React/Vite 源码
├── static/
│   ├── frontend/            # React/Vite 构建产物
│   └── images/              # 项目内视觉资产
├── media/                   # 本地上传文件目录，已被 git 忽略
├── manage.py
├── README.md
├── .env.example
└── .gitignore
```

## 核心数据模型

### Memoir

`Memoir` 表示一条回忆。

主要字段：

- `id`：UUID 主键。
- `title`：标题，必填。
- `story`：正文，可为空。
- `memory_date`：回忆日期，可为空。
- `location`：地点，可为空。
- `mood`：心情标签，可为空。
- `owner`：所属用户，关联 Django 用户模型。
- `created_at` / `updated_at`：创建和更新时间。

排序规则是按 `memory_date` 倒序，再按 `created_at` 倒序。

### MemoirMedia

`MemoirMedia` 表示一条回忆关联的媒体文件。

主要字段：

- `memoir`：所属回忆。
- `file`：上传文件。
- `original_filename`：原始文件名。
- `media_type`：图片或视频。
- `mime_type`：MIME 类型。
- `size`：文件大小。
- `uploaded_at`：上传时间。

上传路径格式：

```text
memoirs/<memoir_id>/<uuid>-<safe_filename>
```

删除 `MemoirMedia` 记录时，项目会通过 `post_delete` 信号同步删除磁盘上的实际文件。

## 主要功能

### 登录与访问控制

- 登录页路径：`/accounts/login/`
- 登录页主标题文案围绕 `回忆替TA陪我`。
- 登出路径：`/accounts/logout/`
- 登录后默认跳转回忆库。
- 未登录用户访问核心页面会被重定向到登录页。
- 普通用户只能查看、编辑、删除自己的回忆。
- 媒体文件通过受保护视图读取，不直接暴露 `media/` 下的静态访问。
- 媒体访问允许文件所属用户或 staff 用户访问，其他用户返回 404。

### 回忆列表

列表页是首页：

```text
/
```

备用路径：

```text
/memoirs/
```

能力：

- 展示当前登录用户的回忆。
- 页面标题文案：`记忆中的TA`。
- 展示回忆总数、照片数和视频数。
- 支持按标题、正文、地点、心情标签搜索。
- 支持按已有心情标签筛选。
- 使用左侧档案栏和紧凑时间线行展示日期、真实媒体缩略图、标题摘要、地点、心情、媒体数、编辑和删除操作。
- 侧栏地点/心情/信笺/媒体是客户端筛选视图，时间排序切换升降序，视图按钮切换列表与媒体密度。
- 展示图片和视频缩略内容。
- 点击媒体可以打开前端预览弹层。

### 新增与编辑回忆

新增路径：

```text
/memoirs/new/
```

编辑路径：

```text
/memoirs/<uuid>/edit/
```

表单字段：

- 标题
- 日期
- 地点
- 心情标签
- 正文
- 多个照片或视频文件

编辑时可以：

- 修改文字字段。
- 追加上传新的媒体文件。
- 勾选删除已有媒体文件。

### 删除回忆

删除路径：

```text
/memoirs/<uuid>/delete/
```

删除操作只接受 POST 请求。删除回忆会级联删除关联媒体记录，媒体记录删除时会清理磁盘文件。

### 媒体类型识别

项目根据上传文件的 `content_type` 和扩展名判断媒体类型。

支持的图片扩展名：

```text
.apng .avif .gif .heic .jpeg .jpg .png .webp
```

支持的视频扩展名：

```text
.m4v .mov .mp4 .mpeg .webm
```

不支持的文件类型会向表单添加错误。

## 路由清单

全局路由在 `config/urls.py`：

- `/admin/`：Django Admin
- `/accounts/login/`：登录
- `/accounts/logout/`：登出
- `/`：引入 `memories.urls`

应用路由在 `memories/urls.py`：

- `/`：回忆列表，名称 `memoir_list`
- `/memoirs/`：回忆列表备用路径，名称 `memoir_list_alt`
- `/memoirs/new/`：新增回忆，名称 `memoir_create`
- `/memoirs/<uuid:pk>/edit/`：编辑回忆，名称 `memoir_update`
- `/memoirs/<uuid:pk>/delete/`：删除回忆，名称 `memoir_delete`
- `/protected-media/<path:file_path>`：受保护媒体读取，名称 `protected_media`

## 管理后台

后台使用 django-jazzmin 美化，站点文案为「前任回忆录」。

后台能力：

- 管理 `Memoir` 和 `MemoirMedia`。
- `Memoir` 后台内联展示关联媒体。
- 图片显示缩略预览。
- 视频提供打开或播放入口。
- 创建回忆时如果没有显式设置 owner，会默认设置为当前后台用户。

## 前端界面

用户可见前端使用 React/Vite。Django Template 只保留轻量挂载壳。

关键模板：

- `templates/base.html`：加载 `static/frontend/app.css`、输出 `#memoirs-root`、写入 `memoirs-initial-data` JSON、加载 `static/frontend/app.js`。
- `templates/registration/login.html`、`templates/registration/register.html`、`templates/memories/*.html`：仅设置页面标题并继承 React 挂载壳。
- `frontend/src/components/`：登录/注册、回忆库、编辑器、手机上传和媒体预览组件。
- `frontend/src/lib/`：初始上下文、CSRF、fetch API 和共享类型。

静态资源：

- `frontend/src/styles/app.css`：React 前端设计系统源码。
- `static/frontend/app.css`：当前 Django 引用的样式产物。
- `static/frontend/app.js`：当前 Django 引用的脚本产物；有 npm 时应由 Vite 构建覆盖。

界面语言是中文，视觉风格偏高端私人纪念册、柔和浅色纸感背景、深墨绿与古金强调色；回忆库列表页是档案工作台，不是营销展示页。

## 配置与环境

`config/settings.py` 会尝试读取项目根目录下的 `.env`。如果不存在 `.env`，项目仍使用默认值运行。

支持的环境变量示例在 `.env.example`：

- `SECRET_KEY`
- `DEBUG`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`

默认本地配置：

- `LANGUAGE_CODE = "zh-hans"`
- `TIME_ZONE = "Asia/Shanghai"`
- `STATIC_URL = "static/"`
- `MEDIA_URL = "media/"`
- `MEDIA_ROOT = BASE_DIR / "media"`

上传限制：

- `FILE_UPLOAD_MAX_MEMORY_SIZE = 20MB`
- `DATA_UPLOAD_MAX_MEMORY_SIZE = 1GB`

## 常用命令

创建 Conda 环境：

```powershell
conda env create -f environment.yml
conda activate memoirs
```

已有环境中安装依赖：

```powershell
pip install -r requirements.txt
```

初始化数据库：

```powershell
python manage.py migrate
python manage.py createsuperuser
```

启动本地服务：

```powershell
python manage.py runserver 127.0.0.1:8017
```

访问地址：

```text
http://127.0.0.1:8017
```

后台地址：

```text
http://127.0.0.1:8017/admin/
```

验证项目：

```powershell
python manage.py check
python manage.py test
```

前端构建：

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

如果 `npm` 不存在：

```powershell
conda install -n memoirs "nodejs>=22"
```

## 测试覆盖

`memories/tests.py` 覆盖了核心行为：

- 核心页面需要登录。
- 创建回忆并上传媒体。
- 列表页显示编辑入口。
- 编辑回忆、替换字段、删除旧媒体并追加新媒体。
- 删除回忆时清理媒体文件。
- 受保护媒体只允许 owner 或 staff 访问。

测试使用 `.test-media/` 作为临时媒体目录，测试结束后会清理。

## 维护注意事项

- 不要绕过 `protected_media` 直接公开 `media/`，否则会破坏私密访问模型。
- 新增媒体类型时，应同时更新 `memories/models.py` 和 `memories/views.py` 中的扩展名识别逻辑。
- 涉及文件删除逻辑时，要确认数据库记录和磁盘文件能同步清理。
- 修改用户可见页面时，应保持 React 前端、中文界面文案和“纪念 TA 的私人回忆档案”视觉方向一致。
- 修改 React 源码后应运行 `npm run build --prefix frontend`，并确认 `static/frontend/` 产物同步。
- 修改表单字段时，需要同步检查模型、表单、模板、后台和测试。
- 项目当前没有使用 Django REST Framework；用户可见前端优先沿用 React/Vite、Django JSON API 和原生 CSS 设计系统。
- `db.sqlite3`、`media/`、`.env`、日志文件和测试媒体目录已被 `.gitignore` 忽略，不应提交。

## 当前项目状态总结

这个项目已经具备一个可用的本地私人回忆管理闭环：登录、创建回忆、上传图片/视频、搜索筛选、编辑、删除、媒体私有访问、后台管理和基础测试。后续增强可以围绕分页、批量导入导出、媒体压缩、更多标签体系、部署安全配置和更细的权限管理展开。
