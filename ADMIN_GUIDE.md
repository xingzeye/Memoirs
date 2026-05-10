# 管理员与部署维护手册

本文面向项目管理员、部署者和维护者，说明如何运行、部署、备份、排障和验证「忆往昔」。

## 1. 项目概览

「忆往昔」是一个基于 Django 的私人回忆管理应用，用户可以保存文字回忆，并为每条回忆附加照片或视频。

主要能力：

- Django 负责认证、页面视图、JSON API、媒体保护、备份导入导出。
- React/Vite 负责登录后用户界面。
- 本地默认 SQLite，生产可使用 PostgreSQL。
- 媒体文件默认在 `media/`，生产建议挂载持久化目录。
- 生产推荐 Zeabur + Neon PostgreSQL + Zeabur Volume。

## 2. 目录结构

```text
Memoirs/
├─ config/              # Django 项目配置
├─ memories/            # 核心业务应用
├─ frontend/            # React/Vite 前端源码
├─ static/              # 静态资源和前端构建产物
├─ templates/           # Django 模板壳
├─ media/               # 本地上传媒体，不能提交
├─ requirements.txt     # pip 依赖
├─ environment.yml      # Conda 环境
├─ zbpack.json          # Zeabur 启动配置
└─ manage.py
```

## 3. 本地运行

### 3.1 使用 Conda

```powershell
conda env create -f environment.yml
conda activate memoirs
```

如果环境已存在：

```powershell
conda activate memoirs
pip install -r requirements.txt
```

### 3.2 使用普通虚拟环境

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 3.3 初始化数据库

```powershell
python manage.py migrate
python manage.py createsuperuser
```

### 3.4 启动开发服务器

```powershell
python manage.py runserver 127.0.0.1:8017
```

访问地址：

```text
http://127.0.0.1:8017/
```

后台地址：

```text
http://127.0.0.1:8017/admin/
```

### 3.5 前端构建

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

如果 Conda 环境没有 npm：

```powershell
conda install -n memoirs "nodejs>=22"
```

构建产物输出到 `static/frontend/`。模板通过 `static/frontend/app.js` 和 `static/frontend/app.css` 加载前端。

## 4. 环境变量

本地开发可以不创建 `.env`，项目会使用默认配置。生产环境必须显式配置关键变量。

常用变量：

| 变量 | 说明 |
| --- | --- |
| `SECRET_KEY` | Django 密钥，生产必须设置 |
| `DEBUG` | 生产应设为 `False` |
| `ALLOWED_HOSTS` | 允许访问的域名，多个值用逗号分隔 |
| `CSRF_TRUSTED_ORIGINS` | 可信来源，例如 `https://example.com` |
| `ALLOW_PUBLIC_REGISTRATION` | 是否允许公开注册，私人部署建议 `False` |
| `MOBILE_UPLOAD_SESSION_TTL_MINUTES` | 手机上传链接有效期，默认 30 |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `MEDIA_ROOT` | 上传文件保存目录 |
| `ZEABUR_WEB_DOMAIN` | Zeabur 域名，配置后自动加入 Host/CSRF |
| `ZEABUR_WEB_URL` | Zeabur 完整 URL，配置后自动加入 Host/CSRF |
| `GUNICORN_TIMEOUT` | Gunicorn 请求超时，默认 600 秒 |
| `DJANGO_SUPERUSER_USERNAME` | 部署时自动创建管理员用户名 |
| `DJANGO_SUPERUSER_EMAIL` | 部署时自动创建管理员邮箱 |
| `DJANGO_SUPERUSER_PASSWORD` | 部署时自动创建管理员密码 |

不要把真实 `.env`、数据库连接串、密码或 token 提交到 Git。

## 5. Zeabur 部署

推荐组合：

- Zeabur 托管 Django 服务。
- Neon 提供 PostgreSQL。
- Zeabur Volume 保存上传图片和视频。

### 5.1 基本步骤

1. 在 Neon 创建 PostgreSQL 数据库，复制连接字符串。
2. 在 Zeabur 从 GitHub 导入本仓库。
3. 在 Zeabur 服务中挂载 Volume，建议挂载到 `/data`。
4. 配置生产环境变量。
5. 部署并观察启动日志。

### 5.2 推荐生产环境变量

```text
DATABASE_URL=<PostgreSQL 连接字符串>
DEBUG=False
ALLOW_PUBLIC_REGISTRATION=False
MEDIA_ROOT=/data/media
SECRET_KEY=<生产随机密钥>
GUNICORN_TIMEOUT=600
DJANGO_SUPERUSER_USERNAME=<管理员用户名>
DJANGO_SUPERUSER_EMAIL=<管理员邮箱>
DJANGO_SUPERUSER_PASSWORD=<管理员初始密码>
```

如果 Zeabur 没有自动注入域名变量，可以手动设置：

```text
ALLOWED_HOSTS=<你的域名>
CSRF_TRUSTED_ORIGINS=https://<你的域名>
```

也可以使用：

```text
ZEABUR_WEB_DOMAIN=<你的域名>
ZEABUR_WEB_URL=https://<你的域名>
```

### 5.3 启动命令

`zbpack.json` 定义生产启动命令：

```sh
mkdir -p ${MEDIA_ROOT:-/data/media} && python manage.py migrate --noinput && python manage.py collectstatic --noinput && python manage.py ensure_superuser && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --timeout ${GUNICORN_TIMEOUT:-600}
```

启动时会：

1. 创建媒体目录。
2. 执行数据库迁移。
3. 收集静态文件。
4. 按环境变量创建管理员账号。
5. 启动 Gunicorn。

`ensure_superuser` 不会覆盖已存在用户的密码。首次部署完成后，建议登录后台修改初始密码，并移除或清空 `DJANGO_SUPERUSER_PASSWORD`。

## 6. 数据与媒体维护

### 6.1 数据库

- 本地默认使用 `db.sqlite3`。
- 生产建议使用 PostgreSQL。
- 结构化数据包括用户、回忆、媒体记录、手机上传会话等。

### 6.2 媒体目录

- 本地默认 `media/`。
- 生产建议 `MEDIA_ROOT=/data/media`，并挂载持久化 Volume。
- `media/` 不应提交到 Git。

### 6.3 受保护媒体

媒体访问走登录保护。只有文件所属用户或 staff 用户可以访问。视频和大文件支持 Range 请求，原文件下载使用预览弹层或 `?download=1`。

### 6.4 缩略图

图片缩略图通过受保护缩略图接口按需生成 WebP。视频缩略图以浏览器读取元数据为主，避免提前完整加载视频。

## 7. 备份导出与导入机制

### 7.1 导出范围

`/memoirs/export/` 只导出当前登录用户未进入回收站的回忆和媒体。回收站内容不会导出。

### 7.2 ZIP 内容

```text
manifest.json
memoirs.json
markdown/<date-or-undated>-<safe-title>-<memoir_id>.md
media/<memoir_id>/<media_id>-<safe-original-filename>
```

### 7.3 导出实现要点

- 使用 Python 标准库 `zipfile`。
- 使用 `SpooledTemporaryFile`，小备份留在内存，超过阈值后落到临时文件。
- 使用 `FileResponse` 返回附件，避免整包放入响应内存。
- 图片和视频使用 `ZIP_STORED` 原样写入，避免重复压缩导致云端请求超时。
- JSON、Markdown、manifest 继续压缩写入。
- 如果媒体记录存在但原文件缺失，导出会跳过该媒体，并在 `manifest.json` 中记录 `skippedMediaCount` 和 `skippedMedia`。

### 7.4 Markdown 预览

图片在 Markdown 中写成：

```markdown
![文件名](../media/...)
```

视频等非图片媒体保留为普通链接。

用户需要完整解压 ZIP，并保持 `markdown/` 与 `media/` 的相对位置不变，否则图片不会显示。

### 7.5 导入规则

`/memoirs/import/` 只接受本应用导出的 ZIP。导入时：

- 创建新的回忆和媒体。
- 归属当前登录账号。
- 不覆盖现有内容。
- 不恢复旧备份里的回收站状态。
- 核心 JSON 损坏、格式不匹配或引用媒体缺失时，本次导入失败并回滚。
- 媒体文件从 ZIP 成员流式保存到 `MEDIA_ROOT`，不把整包或单个大视频一次性读入内存。
- 导入不再调用 `testzip()` 预扫描完整 ZIP，避免大视频备份在云端导入时被额外读取一遍。

## 8. 常用维护命令

运行系统检查：

```powershell
python manage.py check
```

运行后端测试：

```powershell
python manage.py test
```

前端类型检查：

```powershell
npm run check --prefix frontend
```

收集静态文件：

```powershell
python manage.py collectstatic
```

创建或补齐部署管理员：

```powershell
python manage.py ensure_superuser
```

清理过期手机上传临时文件：

```powershell
python manage.py cleanup_mobile_uploads
```

## 9. 常见故障排查

### 9.1 云端 500

检查：

- Zeabur 启动日志和运行日志。
- `DEBUG=False` 下是否设置了 `SECRET_KEY`。
- `ALLOWED_HOSTS` 或 `ZEABUR_WEB_DOMAIN` 是否包含当前域名。
- 数据库迁移是否成功。
- `MEDIA_ROOT` 是否可写。

### 9.2 备份下载超时

检查：

- 当前部署是否包含媒体 `ZIP_STORED` 和 `FileResponse` 导出逻辑。
- `GUNICORN_TIMEOUT` 是否足够大，默认 600 秒。
- 媒体文件是否过多或单个视频过大。
- Zeabur 日志中是否出现 worker timeout。

### 9.3 Markdown 图片不显示

通常是用户只打开了单个 `.md` 文件，或移动了目录。

让用户完整解压 ZIP，并保持：

```text
markdown/
media/
```

两者在同一层级下。

### 9.4 备份导入 500 或长时间无响应

优先检查：

- 当前部署是否包含流式导入逻辑。
- `MEDIA_ROOT` 是否挂载到可写 Volume。
- Volume 或临时目录是否还有足够空间。
- Zeabur 日志中是否出现 worker timeout、磁盘写入失败或 ZIP 损坏错误。

### 9.5 媒体文件打不开

检查：

- `MEDIA_ROOT` 是否指向正确目录。
- 生产 Volume 是否挂载到 `/data`。
- 数据库中的文件路径是否存在于媒体目录。
- 当前访问用户是否为 owner 或 staff。

### 9.6 静态资源异常

检查：

- 是否运行 `collectstatic`。
- `static/frontend/app.js` 和 `static/frontend/app.css` 是否存在。
- WhiteNoise 是否安装。
- 浏览器是否缓存了旧资源。

### 9.7 CSRF 或 Host 错误

检查：

- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `ZEABUR_WEB_DOMAIN`
- `ZEABUR_WEB_URL`
- HTTPS 代理是否正确传递 `X-Forwarded-Proto`

## 10. 维护注意事项

- 不要提交 `.env`、`db.sqlite3`、`media/`、`.test-media/`。
- 不要把生产数据库连接串、密码或 token 写进文档。
- 修改用户可见功能后，同步更新 `README.md`、`PROJECT_GUIDE.md`、`AGENT.md` 和相关使用文档。
- 修改前端后运行 Vite 构建，并确认 `static/frontend/` 产物更新。
- 修改备份格式后同步更新导入逻辑、测试和两份使用文档。
