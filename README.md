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

## 验证

```powershell
python manage.py check
python manage.py test
```
