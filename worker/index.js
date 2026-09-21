const SESSION_USER = { id: 1, username: "Sites Owner", isStaff: true };
const PAGE_SIZE = 20;
const MEDIA_PAGE_SIZE = 60;

const schema = [
  `CREATE TABLE IF NOT EXISTS memoirs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    story TEXT NOT NULL DEFAULT '',
    memory_date TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memoir_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (memoir_id) REFERENCES memoirs(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS memoirs_deleted_date_idx ON memoirs (deleted_at, memory_date, created_at)`,
  `CREATE INDEX IF NOT EXISTS media_memoir_idx ON media_items (memoir_id, uploaded_at)`,
];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/static/") && env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      if (!env.DB) {
        return htmlResponse(renderSetupMissing());
      }

      await ensureSchema(env.DB);

      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, url);
      }
      if (url.pathname.startsWith("/protected-media/")) {
        return handleProtectedMedia(request, env, url.pathname.replace("/protected-media/", ""));
      }
      if (url.pathname.startsWith("/memoirs/export/")) {
        return exportBackup(env);
      }
      if (url.pathname.startsWith("/memoirs/import/")) {
        return json({ errors: { backup: ["Sites 版暂未支持 ZIP 导入，请先使用新增回忆保存文字内容。"] } }, 400);
      }

      return handlePage(request, env, url);
    } catch (error) {
      return json({ errors: { __all__: [error?.message || "Sites 后端处理失败。"] } }, 500);
    }
  },
};

async function ensureSchema(db) {
  for (const sql of schema) {
    await db.prepare(sql).run();
  }
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (path === "/api/session/") return json(sessionPayload());
  if (path === "/api/auth/login/" || path === "/api/auth/register/") return json({ user: SESSION_USER, redirect: "/" }, path.includes("register") ? 201 : 200);
  if (path === "/api/auth/logout/") return json({ redirect: "/" });
  if (path === "/api/memoirs/" && request.method === "GET") return json(await memoirCollectionPayload(env, url));
  if (path === "/api/memoirs/" && request.method === "POST") return createMemoir(request, env);
  if (path === "/api/memoirs/media/" && request.method === "GET") return json(await mediaGalleryPayload(env, url));

  const detail = path.match(/^\/api\/memoirs\/([^/]+)\/$/);
  if (detail && request.method === "GET") return json(await editorPayload(env, detail[1]));
  if (detail && request.method === "POST") return updateMemoir(request, env, detail[1]);

  const media = path.match(/^\/api\/memoirs\/([^/]+)\/media\/$/);
  if (media && request.method === "GET") return json(await memoirMediaPayload(env, media[1], url));

  const action = path.match(/^\/api\/memoirs\/([^/]+)\/(delete|restore|destroy)\/$/);
  if (action && request.method === "POST") return memoirAction(env, action[1], action[2]);

  if (path === "/api/mobile-upload-sessions/") {
    return json({ errors: { __all__: ["Sites 版暂未支持手机扫码上传。"] } }, 400);
  }

  return json({ errors: { __all__: ["未找到接口。"] } }, 404);
}

async function handlePage(request, env, url) {
  const path = url.pathname;
  let page = "archive";
  let payload = {};

  if (path === "/memoirs/new/") {
    page = "editor";
    payload = createEditorPayload();
  } else if (path === "/memoirs/media/") {
    page = "media-gallery";
    payload = await mediaGalleryPayload(env, url);
  } else if (path === "/memoirs/backup/") {
    page = "backup";
    payload = { exportUrl: "/memoirs/export/", importUrl: "/memoirs/import/", stats: await archiveStats(env) };
  } else {
    const edit = path.match(/^\/memoirs\/([^/]+)\/edit\/$/);
    const detail = path.match(/^\/memoirs\/([^/]+)\/$/);
    if (edit) {
      page = "editor";
      payload = await editorPayload(env, edit[1]);
    } else if (detail) {
      page = "detail";
      payload = await detailPayload(env, detail[1], url);
    } else {
      payload = await memoirCollectionPayload(env, url);
    }
  }

  return htmlResponse(renderApp({ page, session: sessionPayload(), payload }));
}

function sessionPayload() {
  return {
    user: SESSION_USER,
    allowPublicRegistration: false,
    csrfToken: "sites",
    routes: {
      session: "/api/session/",
      login: "/api/auth/login/",
      logout: "/api/auth/logout/",
      memoirs: "/api/memoirs/",
      mobileUploadSessions: "/api/mobile-upload-sessions/",
      memoirList: "/",
      memoirCreate: "/memoirs/new/",
      mediaGallery: "/memoirs/media/",
      mediaGalleryApi: "/api/memoirs/media/",
      backup: "/memoirs/backup/",
      exportBackup: "/memoirs/export/",
      importBackup: "/memoirs/import/",
      loginPage: "/",
    },
    uploadLimits: {
      maxRequestBytes: 50 * 1024 * 1024,
      maxMemoryFileBytes: 50 * 1024 * 1024,
    },
  };
}

async function memoirCollectionPayload(env, url) {
  const q = (url.searchParams.get("q") || "").trim();
  const mood = (url.searchParams.get("mood") || "").trim();
  const showingDeleted = url.searchParams.get("deleted") === "1";
  const section = url.searchParams.get("section") || "all";
  const sort = url.searchParams.get("sort") === "asc" ? "asc" : "desc";
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(positiveInt(url.searchParams.get("pageSize"), PAGE_SIZE), 50);

  const conditions = [showingDeleted ? "deleted_at != ''" : "deleted_at = ''"];
  const params = [];
  if (q) {
    conditions.push("(title LIKE ? OR story LIKE ? OR location LIKE ? OR mood LIKE ?)");
    const value = `%${q}%`;
    params.push(value, value, value, value);
  }
  if (mood) {
    conditions.push("mood = ?");
    params.push(mood);
  }
  if (section === "timeline") conditions.push("memory_date != ''");
  if (section === "location") conditions.push("location != ''");
  if (section === "mood") conditions.push("mood != ''");
  if (section === "letter") conditions.push("story != ''");

  const where = conditions.join(" AND ");
  const order = sort === "asc" ? "ASC" : "DESC";
  const offset = (page - 1) * pageSize;
  const rows = await env.DB.prepare(
    `SELECT *, (SELECT COUNT(*) FROM media_items WHERE media_items.memoir_id = memoirs.id) AS media_count
     FROM memoirs WHERE ${where}
     ORDER BY COALESCE(NULLIF(memory_date, ''), created_at) ${order}, created_at ${order}
     LIMIT ? OFFSET ?`,
  ).bind(...params, pageSize + 1, offset).all();
  const items = rows.results || [];
  const memoirs = [];
  for (const row of items.slice(0, pageSize)) {
    const media = await mediaForMemoir(env, row.id, 3, 0);
    memoirs.push(serializeMemoir(row, media, row.media_count));
  }
  const moods = await env.DB.prepare(`SELECT DISTINCT mood FROM memoirs WHERE deleted_at = ? AND mood != '' ORDER BY mood`).bind(showingDeleted ? "1" : "").all();
  return {
    memoirs,
    query: q,
    activeMood: mood,
    showingDeleted,
    section,
    sort,
    pagination: {
      page,
      pageSize,
      hasMore: items.length > pageSize,
      nextPage: items.length > pageSize ? page + 1 : null,
    },
    moodChoices: (moods.results || []).map((row) => row.mood),
    stats: await archiveStats(env),
  };
}

async function createMemoir(request, env) {
  const form = await request.formData();
  const files = form.getAll("media").filter((item) => item instanceof File && item.size > 0);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const values = formValues(form);
  if (!values.title) return json({ errors: { title: ["请输入标题。"] } }, 400);
  await env.DB.prepare(
    `INSERT INTO memoirs (id, title, story, memory_date, location, mood, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).bind(id, values.title, values.story, values.memory_date, values.location, values.mood, now, now).run();
  await saveMediaFiles(env, id, files);
  return json({ memoir: await getSerializedMemoir(env, id), redirect: "/" }, 201);
}

async function updateMemoir(request, env, id) {
  const existing = await getMemoirRow(env, id, true);
  if (!existing) return json({ errors: { __all__: ["没有找到这段回忆。"] } }, 404);
  const form = await request.formData();
  const values = formValues(form);
  if (!values.title) return json({ errors: { title: ["请输入标题。"] } }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE memoirs SET title = ?, story = ?, memory_date = ?, location = ?, mood = ?, updated_at = ? WHERE id = ?`,
  ).bind(values.title, values.story, values.memory_date, values.location, values.mood, now, id).run();
  const deleteIds = form.getAll("delete_media").map((value) => Number(value)).filter(Boolean);
  for (const mediaId of deleteIds) {
    await deleteMedia(env, mediaId, id);
  }
  const files = form.getAll("media").filter((item) => item instanceof File && item.size > 0);
  await saveMediaFiles(env, id, files);
  return json({ memoir: await getSerializedMemoir(env, id), redirect: "/" });
}

async function memoirAction(env, id, action) {
  if (action === "delete") {
    await env.DB.prepare("UPDATE memoirs SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at = ''").bind(new Date().toISOString(), new Date().toISOString(), id).run();
  } else if (action === "restore") {
    await env.DB.prepare("UPDATE memoirs SET deleted_at = '', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  } else if (action === "destroy") {
    const media = await mediaForMemoir(env, id, 1000, 0);
    for (const item of media) await deleteMedia(env, item.id, id);
    await env.DB.prepare("DELETE FROM memoirs WHERE id = ?").bind(id).run();
  }
  return json({ ok: true, stats: await archiveStats(env), redirect: "/" });
}

function formValues(form) {
  return {
    title: String(form.get("title") || "").trim().slice(0, 120),
    story: String(form.get("story") || ""),
    memory_date: String(form.get("memory_date") || "").trim(),
    location: String(form.get("location") || "").trim().slice(0, 120),
    mood: String(form.get("mood") || "").trim().slice(0, 60),
  };
}

async function saveMediaFiles(env, memoirId, files) {
  if (!files.length) return;
  if (!env.MEDIA) throw new Error("Sites R2 media binding is not available yet.");
  for (const file of files) {
    const id = crypto.randomUUID();
    const safeName = safeFilename(file.name || "media");
    const objectKey = `memoirs/${memoirId}/${id}-${safeName}`;
    await env.MEDIA.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    const mediaType = (file.type || "").startsWith("video/") ? "video" : "image";
    await env.DB.prepare(
      `INSERT INTO media_items (memoir_id, object_key, original_filename, media_type, mime_type, size, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(memoirId, objectKey, file.name || safeName, mediaType, file.type || "", file.size || 0, new Date().toISOString()).run();
  }
}

async function handleProtectedMedia(request, env, key) {
  if (!env.MEDIA) return new Response("Media storage is not configured.", { status: 404 });
  const object = await env.MEDIA.get(decodeURIComponent(key));
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=86400");
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set("content-disposition", "attachment");
  }
  return new Response(object.body, { headers });
}

async function deleteMedia(env, mediaId, memoirId) {
  const row = await env.DB.prepare("SELECT object_key FROM media_items WHERE id = ? AND memoir_id = ?").bind(mediaId, memoirId).first();
  if (row?.object_key && env.MEDIA) await env.MEDIA.delete(row.object_key);
  await env.DB.prepare("DELETE FROM media_items WHERE id = ? AND memoir_id = ?").bind(mediaId, memoirId).run();
}

async function detailPayload(env, id, url) {
  const memoir = await getSerializedMemoir(env, id, MEDIA_PAGE_SIZE, 0);
  if (!memoir) return { memoir: null, mediaPagination: pagination(1, MEDIA_PAGE_SIZE, false) };
  return { memoir, mediaPagination: pagination(1, MEDIA_PAGE_SIZE, memoir.mediaCount > MEDIA_PAGE_SIZE) };
}

async function editorPayload(env, id) {
  if (!id) return createEditorPayload();
  const row = await getMemoirRow(env, id, true);
  if (!row) return createEditorPayload();
  const media = await mediaForMemoir(env, id, 1000, 0);
  return {
    mode: "edit",
    memoir: serializeMemoir(row, media, media.length),
    form: { values: formValuesFromRow(row), errors: {} },
    existingMedia: media,
    mobileUpload: emptyMobileUpload("edit", id, row.title),
    apiSubmitUrl: `/api/memoirs/${id}/`,
  };
}

function createEditorPayload() {
  return {
    mode: "create",
    memoir: null,
    form: { values: {}, errors: {} },
    existingMedia: [],
    mobileUpload: emptyMobileUpload("create", "", ""),
    apiSubmitUrl: "/api/memoirs/",
  };
}

function emptyMobileUpload(mode, memoirId, memoirTitle) {
  return {
    token: "",
    mode,
    memoirId,
    memoirTitle,
    uploadUrl: "#",
    qrDataUri: "",
    statusUrl: "",
    active: false,
    expired: false,
    consumed: false,
    expiresAt: "",
    items: [],
  };
}

async function memoirMediaPayload(env, id, url) {
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(positiveInt(url.searchParams.get("pageSize"), MEDIA_PAGE_SIZE), 100);
  const offset = (page - 1) * pageSize;
  const media = await mediaForMemoir(env, id, pageSize + 1, offset);
  return {
    media: media.slice(0, pageSize),
    mediaCount: await mediaCount(env, id),
    pagination: pagination(page, pageSize, media.length > pageSize),
  };
}

async function mediaGalleryPayload(env, url) {
  const type = url.searchParams.get("type") || "";
  const year = url.searchParams.get("year") || "";
  const location = url.searchParams.get("location") || "";
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(positiveInt(url.searchParams.get("pageSize"), MEDIA_PAGE_SIZE), 100);
  const conditions = ["m.deleted_at = ''"];
  const params = [];
  if (type) {
    conditions.push("mi.media_type = ?");
    params.push(type);
  }
  if (year) {
    conditions.push("substr(m.memory_date, 1, 4) = ?");
    params.push(year);
  }
  if (location) {
    conditions.push("m.location = ?");
    params.push(location);
  }
  const offset = (page - 1) * pageSize;
  const rows = await env.DB.prepare(
    `SELECT mi.*, m.title AS memoir_title, m.memory_date, m.location, m.mood
     FROM media_items mi JOIN memoirs m ON mi.memoir_id = m.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(NULLIF(m.memory_date, ''), m.created_at) DESC, mi.uploaded_at ASC
     LIMIT ? OFFSET ?`,
  ).bind(...params, pageSize + 1, offset).all();
  const media = (rows.results || []).map(serializeMedia);
  return {
    media: media.slice(0, pageSize),
    groups: [],
    filters: { type, year, location },
    filterOptions: await mediaFilterOptions(env),
    stats: await mediaStats(env),
    pagination: pagination(page, pageSize, media.length > pageSize),
  };
}

async function mediaFilterOptions(env) {
  const years = await env.DB.prepare("SELECT DISTINCT substr(memory_date, 1, 4) AS year FROM memoirs WHERE deleted_at = '' AND memory_date != '' ORDER BY year DESC").all();
  const locations = await env.DB.prepare("SELECT DISTINCT location FROM memoirs WHERE deleted_at = '' AND location != '' ORDER BY location").all();
  return {
    years: (years.results || []).map((row) => row.year),
    locations: (locations.results || []).map((row) => row.location),
    types: [
      { value: "", label: "全部" },
      { value: "image", label: "照片" },
      { value: "video", label: "视频" },
    ],
  };
}

async function exportBackup(env) {
  const rows = await env.DB.prepare("SELECT * FROM memoirs WHERE deleted_at = '' ORDER BY COALESCE(NULLIF(memory_date, ''), created_at) DESC").all();
  const memoirs = [];
  for (const row of rows.results || []) {
    memoirs.push(serializeMemoir(row, await mediaForMemoir(env, row.id, 1000, 0), await mediaCount(env, row.id)));
  }
  return json({ format: "memoirs-sites-json-v1", exportedAt: new Date().toISOString(), memoirs }, 200, {
    "content-disposition": `attachment; filename="memoirs-sites-backup-${Date.now()}.json"`,
  });
}

async function getSerializedMemoir(env, id, limit = 1000, offset = 0) {
  const row = await getMemoirRow(env, id, true);
  if (!row) return null;
  const media = await mediaForMemoir(env, id, limit, offset);
  return serializeMemoir(row, media, await mediaCount(env, id));
}

async function getMemoirRow(env, id, includeDeleted = false) {
  const sql = includeDeleted ? "SELECT * FROM memoirs WHERE id = ?" : "SELECT * FROM memoirs WHERE id = ? AND deleted_at = ''";
  return env.DB.prepare(sql).bind(id).first();
}

async function mediaForMemoir(env, memoirId, limit, offset) {
  const rows = await env.DB.prepare(
    `SELECT mi.*, m.title AS memoir_title, m.memory_date, m.location, m.mood
     FROM media_items mi JOIN memoirs m ON mi.memoir_id = m.id
     WHERE mi.memoir_id = ?
     ORDER BY mi.uploaded_at ASC, mi.id ASC
     LIMIT ? OFFSET ?`,
  ).bind(memoirId, limit, offset).all();
  return (rows.results || []).map(serializeMedia);
}

async function mediaCount(env, memoirId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM media_items WHERE memoir_id = ?").bind(memoirId).first();
  return Number(row?.count || 0);
}

async function archiveStats(env) {
  const memoirs = await env.DB.prepare("SELECT COUNT(*) AS count FROM memoirs WHERE deleted_at = ''").first();
  const deleted = await env.DB.prepare("SELECT COUNT(*) AS count FROM memoirs WHERE deleted_at != ''").first();
  const media = await mediaStats(env);
  return {
    memoirs: Number(memoirs?.count || 0),
    deletedMemoirs: Number(deleted?.count || 0),
    media: media.media,
    photos: media.photos,
    videos: media.videos,
  };
}

async function mediaStats(env) {
  const rows = await env.DB.prepare(
    `SELECT media_type, COUNT(*) AS count
     FROM media_items mi JOIN memoirs m ON mi.memoir_id = m.id
     WHERE m.deleted_at = ''
     GROUP BY media_type`,
  ).all();
  let photos = 0;
  let videos = 0;
  for (const row of rows.results || []) {
    if (row.media_type === "video") videos = Number(row.count || 0);
    else photos += Number(row.count || 0);
  }
  return { media: photos + videos, photos, videos };
}

function serializeMemoir(row, media, mediaCountValue) {
  return {
    id: row.id,
    title: row.title,
    story: row.story || "",
    excerpt: (row.story || "").slice(0, 96),
    memoryDate: row.memory_date || "",
    dateLabel: row.memory_date || "某一天",
    location: row.location || "",
    mood: row.mood || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: Boolean(row.deleted_at),
    deletedAt: row.deleted_at || "",
    mediaCount: Number(mediaCountValue || media.length || 0),
    media,
    urls: {
      detail: `/memoirs/${row.id}/`,
      edit: `/memoirs/${row.id}/edit/`,
      delete: `/memoirs/${row.id}/delete/`,
      restore: `/memoirs/${row.id}/restore/`,
      destroy: `/memoirs/${row.id}/destroy/`,
      api: `/api/memoirs/${row.id}/`,
      media: `/api/memoirs/${row.id}/media/`,
      apiDelete: `/api/memoirs/${row.id}/delete/`,
      apiRestore: `/api/memoirs/${row.id}/restore/`,
      apiDestroy: `/api/memoirs/${row.id}/destroy/`,
    },
  };
}

function serializeMedia(row) {
  const url = `/protected-media/${encodeURIComponent(row.object_key)}`;
  return {
    id: Number(row.id),
    url,
    absoluteUrl: url,
    thumbnailUrl: row.media_type === "image" ? url : "",
    downloadUrl: `${url}?download=1`,
    type: row.media_type === "video" ? "video" : "image",
    name: row.original_filename || "media",
    mimeType: row.mime_type || "",
    size: Number(row.size || 0),
    uploadedAt: row.uploaded_at,
    memoirId: row.memoir_id,
    memoirTitle: row.memoir_title || "",
    memoirUrl: `/memoirs/${row.memoir_id}/`,
    memoryDate: row.memory_date || "",
    dateLabel: row.memory_date || "未记录日期",
    location: row.location || "",
    mood: row.mood || "",
  };
}

function formValuesFromRow(row) {
  return {
    title: row.title || "",
    story: row.story || "",
    memory_date: row.memory_date || "",
    location: row.location || "",
    mood: row.mood || "",
  };
}

function pagination(page, pageSize, hasMore) {
  return { page, pageSize, hasMore, nextPage: hasMore ? page + 1 : null };
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeFilename(name) {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "media";
}

function renderApp(initialData) {
  const payload = JSON.stringify(initialData).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Memoirs | 私人回忆库</title>
  <link rel="stylesheet" href="/static/frontend/app.css" />
</head>
<body>
  <div id="memoirs-root"></div>
  <script id="memoirs-initial-data" type="application/json">${payload}</script>
  <script type="module" src="/static/frontend/app.js"></script>
</body>
</html>`;
}

function renderSetupMissing() {
  return `<!doctype html><meta charset="utf-8"><title>Memoirs</title><main style="font-family: system-ui; max-width: 760px; margin: 80px auto; line-height: 1.7"><h1>Memoirs Sites 后端需要 D1 绑定</h1><p>当前部署没有检测到 <code>DB</code> 绑定。请确认 Sites 项目已按 <code>.openai/hosting.json</code> 配置 D1 后重新部署。</p></main>`;
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
