# Memoirs

一个基于 Django 的私人回忆管理应用，用来记录、搜索和管理个人回忆，并为每条回忆附加图片或视频。

项目默认适合本地使用，也已经准备好部署到 Zeabur，并可通过 Neon PostgreSQL 和持久化 Volume 保存生产数据与上传文件。

## 功能

- 用户注册、登录、退出
- 可通过环境变量关闭公开注册
- 创建、编辑、删除自己的回忆
- 按标题、正文、地点、心情标签搜索
- 按心情标签筛选
- 为回忆上传多张图片或多个视频
- 编辑回忆时追加或删除已有媒体文件
- 电脑端新建/编辑回忆时可扫码，用手机相册上传照片或视频
- 已选择和手机上传的图片/视频会在表单中显示缩略预览
- 媒体文件通过登录保护访问
- Django Admin 后台管理
- 支持本地 SQLite 和生产 PostgreSQL
- 支持 WhiteNoise 静态文件服务

## 当前页面文案

- 登录页主标题：`回忆替TA陪我`
- 回忆列表 Hero 标题：`记忆中的TA`

## 技术栈

- Python 3.12
- Django 5.x
- SQLite / PostgreSQL
- Django Templates
- 原生 CSS / JavaScript
- Pillow
- qrcode
- django-simpleui
- dj-database-url
- psycopg
- gunicorn
- WhiteNoise

## 项目结构

```text
Memoirs/
├─ config/                         # Django 项目配置
├─ memories/                       # 回忆管理应用
│  ├─ models.py                    # Memoir 和 MemoirMedia 模型
│  ├─ views.py                     # 页面视图、上传、搜索、私有媒体访问
│  ├─ forms.py                     # 注册表单和回忆表单
│  ├─ urls.py                      # 应用路由
│  └─ management/commands/         # 部署辅助命令
├─ templates/                      # 页面模板
├─ static/                         # 静态资源
├─ media/                          # 本地上传文件目录
├─ .env.example                    # 环境变量示例
├─ environment.yml                 # Conda 环境
├─ requirements.txt                # pip 依赖
├─ zbpack.json                     # Zeabur 构建和启动配置
└─ manage.py                       # Django 管理入口
```

## 本地运行

### 1. 创建环境

使用 Conda：

```powershell
conda env create -f environment.yml
conda activate memoirs
```

如果环境已经存在：

```powershell
conda activate memoirs
pip install -r requirements.txt
```

也可以使用普通虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 初始化数据库

```powershell
python manage.py migrate
python manage.py createsuperuser
```

### 3. 启动开发服务器

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

## 环境变量

本地开发可以不创建 `.env`，项目会使用默认配置：

- `DEBUG=True`
- SQLite 数据库：`db.sqlite3`
- 上传目录：`media/`
- 允许本地公开注册

如果需要自定义配置，可以复制 `.env.example` 为 `.env`：

```powershell
Copy-Item .env.example .env
```

常用变量：

| 变量 | 说明 |
| --- | --- |
| `SECRET_KEY` | Django 密钥，生产环境必须设置 |
| `DEBUG` | 是否开启调试模式 |
| `ALLOWED_HOSTS` | 允许访问的域名，多个值用逗号分隔 |
| `CSRF_TRUSTED_ORIGINS` | CSRF 信任来源 |
| `ALLOW_PUBLIC_REGISTRATION` | 是否允许公开注册 |
| `MOBILE_UPLOAD_SESSION_TTL_MINUTES` | 手机扫码上传链接有效分钟数，默认 30 |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `MEDIA_ROOT` | 上传文件保存目录 |
| `ZEABUR_WEB_DOMAIN` | Zeabur 提供的域名 |
| `ZEABUR_WEB_URL` | Zeabur 提供的完整 URL |
| `DJANGO_SUPERUSER_USERNAME` | 部署时自动创建的管理员用户名 |
| `DJANGO_SUPERUSER_EMAIL` | 部署时自动创建的管理员邮箱 |
| `DJANGO_SUPERUSER_PASSWORD` | 部署时自动创建的管理员密码 |

## 部署到 Zeabur

推荐生产组合：

- Zeabur 托管 Django 服务
- Neon 提供 PostgreSQL 数据库
- Zeabur Volume 保存上传的图片和视频

部署步骤：

1. 在 Neon 创建 PostgreSQL 数据库，复制带 `sslmode=require` 的连接字符串。
2. 在 Zeabur 创建项目，并从 GitHub 导入本仓库。
3. 在 Zeabur 服务中挂载 Volume，建议挂载到 `/data`。
4. 配置环境变量：

```text
DATABASE_URL=<Neon PostgreSQL 连接字符串>
DEBUG=False
ALLOW_PUBLIC_REGISTRATION=False
MEDIA_ROOT=/data/media
SECRET_KEY=<足够长的随机字符串>
DJANGO_SUPERUSER_USERNAME=<管理员用户名>
DJANGO_SUPERUSER_EMAIL=<管理员邮箱>
DJANGO_SUPERUSER_PASSWORD=<管理员密码>
```

`zbpack.json` 已经配置启动命令，会自动执行：

- 创建媒体目录
- 数据库迁移
- 收集静态文件
- 创建管理员账号
- 使用 gunicorn 启动服务

## 常用命令

运行检查：

```powershell
python manage.py check
```

运行测试：

```powershell
python manage.py test
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

## 注意事项

- 不要提交 `.env`、`db.sqlite3`、`media/` 或 `.test-media/`。
- 生产环境必须设置 `SECRET_KEY`，并关闭 `DEBUG`。
- 如果部署给少数私人用户使用，建议保持 `ALLOW_PUBLIC_REGISTRATION=False`。
- 上传文件默认保存在本地 `media/`，生产环境请使用持久化 Volume。
