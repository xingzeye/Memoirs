# 前任回忆录

本地优先的 Django 私人回忆库，支持注册登录、上传照片/视频、浏览回忆、删除回忆和 SimpleUI 管理员后台。

## 创建环境

```powershell
conda env create -f environment.yml
conda activate memoirs
```

如果环境已经存在：

```powershell
conda activate memoirs
pip install -r requirements.txt
```

## 初始化数据库

```powershell
python manage.py migrate
python manage.py createsuperuser
```

## 启动

```powershell
python manage.py runserver 127.0.0.1:8017
```

打开：

```text
http://127.0.0.1:8017
```

管理员后台：

```text
http://127.0.0.1:8017/admin/
```

## 本地配置

项目可直接运行，不需要 `.env`。如果以后准备公网部署，可以参考 `.env.example` 创建 `.env`，配置 `SECRET_KEY`、`DEBUG`、`ALLOWED_HOSTS` 等。

上传文件默认保存在 `media/`，数据库默认是 `db.sqlite3`。

## Zeabur + Neon + Volume 部署

公网部署使用 Zeabur、Neon PostgreSQL 和 Zeabur Volume。不要上传本地的 `db.sqlite3`、`media/` 或 `.env`。

1. 在 Neon 创建 PostgreSQL 项目，区域建议选择 Singapore，复制带 `sslmode=require` 的连接字符串。
2. 在 Zeabur 新建项目，添加 GitHub 服务，选择本仓库和部署分支。
3. 在服务的 Volumes 页挂载 Volume，`Mount Directory` 填 `/data`。
4. 在 Zeabur 环境变量中填写：
   - `DATABASE_URL`：Neon 连接字符串。
   - `DEBUG=False`
   - `ALLOW_PUBLIC_REGISTRATION=False`
   - `MEDIA_ROOT=/data/media`
   - `SECRET_KEY`：一串足够长的随机字符串。
   - `DJANGO_SUPERUSER_USERNAME`、`DJANGO_SUPERUSER_EMAIL`、`DJANGO_SUPERUSER_PASSWORD`。
5. 首次部署后访问 Zeabur 分配的域名，使用超级用户登录 `/admin/` 创建普通账号。

生产默认关闭公开注册：`ALLOW_PUBLIC_REGISTRATION=False`。如果明确要开放注册，可以在 Zeabur 中改成 `True`。

## 验证

```powershell
python manage.py check
python manage.py test
```
