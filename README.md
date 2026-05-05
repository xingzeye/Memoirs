# Memoirs

一个基于 Django 的私人回忆管理应用，用来记录、搜索和管理个人回忆，并为每条回忆附加图片或视频。

项目默认适合本地使用，也已经准备好部署到 Zeabur，并可通过 Neon PostgreSQL 和持久化 Volume 保存生产数据与上传文件。

## 功能

- 登录和注册表单的图标输入框在点击后只保留外层焦点高亮，避免内部输入框重复描边。
- 回忆库时间线行点击后进入独立回忆详情页，展示完整正文和全部照片/视频。
- 心情筛选只展示用户实际填写过的心情，不再显示默认兜底标签。
- 新增/编辑回忆时心情使用常见选项下拉选择，正文保持普通文本输入。
- 移动端新增/编辑回忆时隐藏手机扫码上传二维码和上传状态卡片，避免手机上重复出现桌面辅助入口。
- 用户注册、登录、退出
- 可通过环境变量关闭公开注册
- 创建、编辑、删除自己的回忆
- 按标题、正文、地点、心情标签搜索
- 按心情标签筛选
- 为回忆上传多张图片或多个视频
- 编辑回忆时追加或删除已有媒体文件
- 电脑端新建/编辑回忆时可扫码，用手机相册上传照片或视频
- 已选择和手机上传的图片/视频会在表单中显示缩略预览
- 用户可见前端已切换为 React/Vite 应用壳，Django 负责认证、API、媒体保护和静态文件服务
- 高级私人纪念册视觉：围绕“TA”“旧时光”“私密保存”组织登录、列表、编辑和手机上传体验
- 回忆库首页采用左侧深墨绿档案栏、顶部搜索筛选和紧凑时间线列表，贴近私人档案工作台
- 回忆库侧栏可切换时间线、地点、心情、信笺、媒体和回收站视图；时间排序、列表/媒体视图和账号菜单均为真实交互
- 时间线视图只显示填写了回忆日期的条目，未写日期的回忆仍保留在全部列表中
- 回忆列表只展示真实图片/视频缩略图，不为缺失媒体渲染空占位框
- 媒体文件通过登录保护访问
- Django Admin 后台管理
- 支持本地 SQLite 和生产 PostgreSQL
- 支持 WhiteNoise 静态文件服务

## 当前页面文案

- 登录页主标题（React 登录态）：`回忆替TA陪我`
- 回忆库标题：`记忆中的TA`
- 回忆库统计：展示回忆段数、照片数和视频数；没有信笺模型时不虚构信笺数据

## 技术栈

- Python 3.12
- Django 5.x
- SQLite / PostgreSQL
- Django Templates
- React 18 + Vite + TypeScript
- Django JSON API + Session/CSRF 认证
- 原生 CSS 设计系统
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
├─ frontend/                       # React/Vite 前端源码
├─ static/                         # 静态资源
│  ├─ frontend/                    # Vite 构建产物，Django 页面直接引用
│  └─ images/                      # 项目内视觉资产，不依赖远程图片
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

### 4. 构建前端

前端源码位于 `frontend/`，构建产物输出到 `static/frontend/`。构建不会清空输出目录。
模板引用 `app.js` / `app.css` 时带前端版本参数，用来避免浏览器继续缓存旧界面。

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

如果当前 conda 环境没有 `npm`，可先为 `memoirs` 环境安装 Node.js/npm：

```powershell
conda install -n memoirs "nodejs>=22"
```

在 npm 不可用时，`static/frontend/app.js` 内保留了一个轻量 fallback，避免页面空白；正式交付应以 Vite 构建后的 React bundle 为准。

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
