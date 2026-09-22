import { unzipSync } from "fflate";

const SESSION_USER = { id: 1, username: "Sites Owner", isStaff: true };
const PAGE_SIZE = 20;
const MEDIA_PAGE_SIZE = 60;
const BACKUP_FORMAT_VERSION = 1;
const IMPORT_MULTIPART_THRESHOLD = 24 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".mpeg", ".webm"]);

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
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'uploading',
    expected_memoirs INTEGER NOT NULL DEFAULT 0,
    expected_media INTEGER NOT NULL DEFAULT 0,
    uploaded_media INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS import_job_memoirs (
    job_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    memoir_id TEXT NOT NULL,
    title TEXT NOT NULL,
    story TEXT NOT NULL DEFAULT '',
    memory_date TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (job_id, ordinal)
  )`,
  `CREATE TABLE IF NOT EXISTS import_job_media (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    memoir_ordinal INTEGER NOT NULL,
    archive_path TEXT NOT NULL,
    object_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    upload_id TEXT NOT NULL DEFAULT '',
    UNIQUE (job_id, archive_path)
  )`,
  `CREATE INDEX IF NOT EXISTS import_job_media_job_idx ON import_job_media (job_id, status)`,
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
      if (url.pathname.startsWith("/memoirs/import/jobs/")) {
        return handleLargeImport(request, env, url);
      }
      if (url.pathname === "/memoirs/import/") {
        return importBackup(request, env);
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
    payload = {
      exportUrl: "/memoirs/export/",
      importUrl: "/memoirs/import/",
      largeImportUrl: "/memoirs/import/jobs/",
      stats: await archiveStats(env),
    };
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
  const files = form.getAll("media").filter(isUploadedFile);
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
  const files = form.getAll("media").filter(isUploadedFile);
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

function isUploadedFile(item) {
  return Boolean(item && typeof item === "object" && typeof item.arrayBuffer === "function" && typeof item.stream === "function" && Number(item.size || 0) > 0);
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

async function handleLargeImport(request, env, url) {
  const path = url.pathname;
  if (path === "/memoirs/import/jobs/" && request.method === "POST") {
    return startLargeImport(request, env);
  }

  const finalize = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/finalize\/$/);
  if (finalize && request.method === "POST") return finalizeLargeImport(env, finalize[1]);

  const cancel = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/cancel\/$/);
  if (cancel && request.method === "POST") return cancelLargeImport(env, cancel[1]);

  const direct = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/media\/([^/]+)\/$/);
  if (direct && request.method === "POST") return uploadImportMedia(request, env, direct[1], direct[2]);

  const multipartStart = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/media\/([^/]+)\/multipart\/$/);
  if (multipartStart && request.method === "POST") return startImportMultipart(env, multipartStart[1], multipartStart[2]);

  const multipartPart = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/media\/([^/]+)\/parts\/(\d+)\/$/);
  if (multipartPart && request.method === "PUT") {
    return uploadImportPart(request, env, multipartPart[1], multipartPart[2], Number(multipartPart[3]));
  }

  const multipartComplete = path.match(/^\/memoirs\/import\/jobs\/([^/]+)\/media\/([^/]+)\/complete\/$/);
  if (multipartComplete && request.method === "POST") {
    return completeImportMultipart(request, env, multipartComplete[1], multipartComplete[2]);
  }

  return json({ errors: { __all__: ["未找到大备份导入接口。"] } }, 404);
}

async function startLargeImport(request, env) {
  if (!env.MEDIA) return json({ errors: { backup: ["Sites 媒体存储尚未配置。"] } }, 503);
  let payload;
  let jobId = "";
  try {
    payload = await request.json();
  } catch {
    return json({ errors: { backup: ["备份清单不是有效的 JSON。"] } }, 400);
  }

  try {
    if (payload?.manifest?.app !== "Memoirs" || payload?.manifest?.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new Error("请上传由本应用导出的备份 ZIP。");
    }
    const prepared = prepareLargeImportMemoirs(payload?.memoirs);
    const mediaCount = prepared.reduce((total, memoir) => total + memoir.media.length, 0);
    jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO import_jobs (id, status, expected_memoirs, expected_media, uploaded_media, created_at, updated_at)
       VALUES (?, 'uploading', ?, ?, 0, ?, ?)`,
    ).bind(jobId, prepared.length, mediaCount, now, now).run();

    const memoirRows = [];
    const mediaRows = [];
    const uploadItems = [];
    for (const [ordinal, memoir] of prepared.entries()) {
      const memoirId = crypto.randomUUID();
      memoirRows.push([jobId, ordinal, memoirId, memoir.title, memoir.story, memoir.memoryDate, memoir.location, memoir.mood]);
      for (const media of memoir.media) {
        const mediaId = crypto.randomUUID();
        const objectKey = `memoirs/${memoirId}/${mediaId}-${media.storageFilename}`;
        mediaRows.push([
          mediaId,
          jobId,
          ordinal,
          media.archivePath,
          objectKey,
          media.originalFilename,
          media.mediaType,
          media.mimeType,
          media.fileSize,
          "pending",
          "",
        ]);
        uploadItems.push({
          id: mediaId,
          archivePath: media.archivePath,
          size: media.fileSize,
          mimeType: media.mimeType,
          multipart: media.fileSize > IMPORT_MULTIPART_THRESHOLD,
        });
      }
    }
    const statements = [
      ...bulkInsertStatements(env.DB, "import_job_memoirs", ["job_id", "ordinal", "memoir_id", "title", "story", "memory_date", "location", "mood"], memoirRows),
      ...bulkInsertStatements(env.DB, "import_job_media", ["id", "job_id", "memoir_ordinal", "archive_path", "object_key", "original_filename", "media_type", "mime_type", "size", "status", "upload_id"], mediaRows),
    ];
    await runBatches(env.DB, statements);
    return json({ jobId, media: uploadItems, multipartThreshold: IMPORT_MULTIPART_THRESHOLD }, 201);
  } catch (error) {
    if (jobId) {
      try {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM import_job_media WHERE job_id = ?").bind(jobId),
          env.DB.prepare("DELETE FROM import_job_memoirs WHERE job_id = ?").bind(jobId),
          env.DB.prepare("DELETE FROM import_jobs WHERE id = ?").bind(jobId),
        ]);
      } catch {}
    }
    return json({ errors: { backup: [error?.message || "无法创建导入任务。"] } }, 400);
  }
}

function prepareLargeImportMemoirs(memoirsPayload) {
  if (!Array.isArray(memoirsPayload)) throw new Error("memoirs.json 缺少回忆列表。");
  if (memoirsPayload.length > 500) throw new Error("单次最多导入 500 段回忆，请拆分备份后重试。");
  const archivePaths = new Set();
  let totalMedia = 0;
  return memoirsPayload.map((memoirRecord, memoirIndex) => {
    if (!memoirRecord || typeof memoirRecord !== "object" || Array.isArray(memoirRecord)) {
      throw new Error("memoirs.json 中存在格式不正确的回忆记录。");
    }
    const mediaRecords = memoirRecord.media || [];
    if (!Array.isArray(mediaRecords)) throw new Error("备份回忆中的媒体列表格式不正确。");
    totalMedia += mediaRecords.length;
    if (totalMedia > 2000) throw new Error("单次最多导入 2000 个媒体文件，请拆分备份后重试。");

    const media = mediaRecords.map((mediaRecord, mediaIndex) => {
      if (!mediaRecord || typeof mediaRecord !== "object" || Array.isArray(mediaRecord)) {
        throw new Error("备份回忆中的媒体记录格式不正确。");
      }
      const archivePath = cleanBackupArchivePath(mediaRecord.archivePath);
      if (archivePaths.has(archivePath)) throw new Error(`备份中存在重复媒体路径：${archivePath}`);
      archivePaths.add(archivePath);
      const fileSize = Number(mediaRecord.archiveSize);
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error(`无法确认媒体文件大小：${archivePath}`);
      const originalFilename = backupText(mediaRecord.originalFilename, 255) || archivePath.split("/").pop() || `media-${memoirIndex + 1}-${mediaIndex + 1}`;
      const storageFilename = safeFilename(originalFilename).slice(0, 120) || `media-${memoirIndex + 1}-${mediaIndex + 1}`;
      const { mediaType, mimeType } = backupMediaClassification(mediaRecord, originalFilename);
      return { archivePath, originalFilename, storageFilename, mediaType, mimeType, fileSize };
    });

    return {
      title: backupText(memoirRecord.title, 120) || `导入的回忆 ${memoirIndex + 1}`,
      story: backupText(memoirRecord.story, null, false),
      memoryDate: backupImportDate(memoirRecord.memoryDate),
      location: backupText(memoirRecord.location, 120),
      mood: backupText(memoirRecord.mood, 60),
      media,
    };
  });
}

async function runBatches(db, statements, size = 50) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function bulkInsertStatements(db, table, columns, rows) {
  if (!rows.length) return [];
  const rowsPerStatement = Math.max(1, Math.floor(100 / columns.length));
  const statements = [];
  for (let index = 0; index < rows.length; index += rowsPerStatement) {
    const chunk = rows.slice(index, index + rowsPerStatement);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    statements.push(
      db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`)
        .bind(...chunk.flat()),
    );
  }
  return statements;
}

async function getImportMedia(env, jobId, mediaId) {
  return env.DB.prepare(
    `SELECT im.*, ij.status AS job_status
     FROM import_job_media im JOIN import_jobs ij ON ij.id = im.job_id
     WHERE im.job_id = ? AND im.id = ?`,
  ).bind(jobId, mediaId).first();
}

async function uploadImportMedia(request, env, jobId, mediaId) {
  const media = await getImportMedia(env, jobId, mediaId);
  if (!media) return json({ errors: { backup: ["导入任务或媒体不存在。"] } }, 404);
  if (media.job_status !== "uploading") return json({ errors: { backup: ["导入任务已结束。"] } }, 409);
  if (media.status === "uploaded") return json({ uploaded: true, mediaId });
  const contentLength = Number(request.headers.get("content-length") || -1);
  if (contentLength >= 0 && contentLength !== Number(media.size)) {
    return json({ errors: { backup: ["媒体文件大小与备份清单不一致。"] } }, 400);
  }
  await env.MEDIA.put(media.object_key, request.body || new Uint8Array(), {
    httpMetadata: { contentType: media.mime_type || "application/octet-stream" },
  });
  const stored = await env.MEDIA.head(media.object_key);
  if (!stored || Number(stored.size) !== Number(media.size)) {
    await env.MEDIA.delete(media.object_key);
    return json({ errors: { backup: ["媒体上传不完整，请重试。"] } }, 400);
  }
  await markImportMediaUploaded(env, jobId, mediaId);
  return json({ uploaded: true, mediaId });
}

async function startImportMultipart(env, jobId, mediaId) {
  const media = await getImportMedia(env, jobId, mediaId);
  if (!media) return json({ errors: { backup: ["导入任务或媒体不存在。"] } }, 404);
  if (media.job_status !== "uploading") return json({ errors: { backup: ["导入任务已结束。"] } }, 409);
  if (media.status === "uploaded") return json({ uploaded: true, mediaId });
  if (media.upload_id) return json({ uploadId: media.upload_id, mediaId });
  const upload = await env.MEDIA.createMultipartUpload(media.object_key, {
    httpMetadata: { contentType: media.mime_type || "application/octet-stream" },
  });
  await env.DB.prepare("UPDATE import_job_media SET upload_id = ?, status = 'multipart' WHERE job_id = ? AND id = ?")
    .bind(upload.uploadId, jobId, mediaId).run();
  return json({ uploadId: upload.uploadId, mediaId }, 201);
}

async function uploadImportPart(request, env, jobId, mediaId, partNumber) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return json({ errors: { backup: ["媒体分片编号无效。"] } }, 400);
  }
  const media = await getImportMedia(env, jobId, mediaId);
  if (!media?.upload_id || media.status !== "multipart" || media.job_status !== "uploading") {
    return json({ errors: { backup: ["媒体分片上传尚未初始化。"] } }, 409);
  }
  const upload = env.MEDIA.resumeMultipartUpload(media.object_key, media.upload_id);
  const part = await upload.uploadPart(partNumber, request.body || new Uint8Array());
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeImportMultipart(request, env, jobId, mediaId) {
  const media = await getImportMedia(env, jobId, mediaId);
  if (!media) return json({ errors: { backup: ["导入任务或媒体不存在。"] } }, 404);
  if (media.status === "uploaded") return json({ uploaded: true, mediaId });
  if (!media.upload_id || media.status !== "multipart" || media.job_status !== "uploading") {
    return json({ errors: { backup: ["媒体分片上传尚未初始化。"] } }, 409);
  }
  const payload = await request.json();
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  if (!parts.length || parts.some((part) => !Number.isInteger(part?.partNumber) || typeof part?.etag !== "string")) {
    return json({ errors: { backup: ["媒体分片清单无效。"] } }, 400);
  }
  const upload = env.MEDIA.resumeMultipartUpload(media.object_key, media.upload_id);
  await upload.complete(parts);
  const stored = await env.MEDIA.head(media.object_key);
  if (!stored || Number(stored.size) !== Number(media.size)) {
    await env.MEDIA.delete(media.object_key);
    await env.DB.prepare("UPDATE import_job_media SET status = 'pending', upload_id = '' WHERE job_id = ? AND id = ?")
      .bind(jobId, mediaId).run();
    return json({ errors: { backup: ["媒体分片合并后的大小不正确，请重试。"] } }, 400);
  }
  await markImportMediaUploaded(env, jobId, mediaId);
  return json({ uploaded: true, mediaId });
}

async function markImportMediaUploaded(env, jobId, mediaId) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE import_job_media SET status = 'uploaded', upload_id = '' WHERE job_id = ? AND id = ?")
      .bind(jobId, mediaId),
    env.DB.prepare(
      `UPDATE import_jobs SET uploaded_media = (
         SELECT COUNT(*) FROM import_job_media WHERE job_id = ? AND status = 'uploaded'
       ), updated_at = ? WHERE id = ?`,
    ).bind(jobId, now, jobId),
  ]);
}

async function finalizeLargeImport(env, jobId) {
  const job = await env.DB.prepare("SELECT * FROM import_jobs WHERE id = ?").bind(jobId).first();
  if (!job) return json({ errors: { backup: ["导入任务不存在。"] } }, 404);
  if (job.status === "complete") {
    return json({ imported: { memoirs: Number(job.expected_memoirs), media: Number(job.expected_media) }, stats: await archiveStats(env) });
  }
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM import_job_media WHERE job_id = ? AND status != 'uploaded'").bind(jobId).first();
  if (Number(pending?.count || 0) > 0) {
    return json({ errors: { backup: [`还有 ${pending.count} 个媒体文件未上传完成。`] } }, 409);
  }
  const memoirRows = await env.DB.prepare("SELECT * FROM import_job_memoirs WHERE job_id = ? ORDER BY ordinal").bind(jobId).all();
  const mediaRows = await env.DB.prepare("SELECT * FROM import_job_media WHERE job_id = ? ORDER BY memoir_ordinal, archive_path").bind(jobId).all();
  const now = new Date().toISOString();
  const memoirByOrdinal = new Map();
  const finalMemoirRows = [];
  const finalMediaRows = [];
  for (const memoir of memoirRows.results || []) {
    memoirByOrdinal.set(Number(memoir.ordinal), memoir);
    finalMemoirRows.push([memoir.memoir_id, memoir.title, memoir.story, memoir.memory_date, memoir.location, memoir.mood, "", now, now]);
  }
  for (const media of mediaRows.results || []) {
    const memoir = memoirByOrdinal.get(Number(media.memoir_ordinal));
    if (!memoir) return json({ errors: { backup: ["导入任务中的回忆映射已损坏。"] } }, 500);
    finalMediaRows.push([memoir.memoir_id, media.object_key, media.original_filename, media.media_type, media.mime_type, media.size, now]);
  }
  const statements = [
    ...bulkInsertStatements(env.DB, "memoirs", ["id", "title", "story", "memory_date", "location", "mood", "deleted_at", "created_at", "updated_at"], finalMemoirRows),
    ...bulkInsertStatements(env.DB, "media_items", ["memoir_id", "object_key", "original_filename", "media_type", "mime_type", "size", "uploaded_at"], finalMediaRows),
  ];
  statements.push(env.DB.prepare("UPDATE import_jobs SET status = 'complete', updated_at = ? WHERE id = ?").bind(now, jobId));
  await env.DB.batch(statements);
  return json({
    imported: { memoirs: Number(job.expected_memoirs), media: Number(job.expected_media) },
    stats: await archiveStats(env),
  });
}

async function cancelLargeImport(env, jobId) {
  const rows = await env.DB.prepare("SELECT object_key, upload_id FROM import_job_media WHERE job_id = ?").bind(jobId).all();
  for (const media of rows.results || []) {
    if (media.upload_id) {
      try {
        await env.MEDIA.resumeMultipartUpload(media.object_key, media.upload_id).abort();
      } catch {}
    }
    try {
      await env.MEDIA.delete(media.object_key);
    } catch {}
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM import_job_media WHERE job_id = ?").bind(jobId),
    env.DB.prepare("DELETE FROM import_job_memoirs WHERE job_id = ?").bind(jobId),
    env.DB.prepare("DELETE FROM import_jobs WHERE id = ?").bind(jobId),
  ]);
  return json({ cancelled: true });
}

async function importBackup(request, env) {
  if (request.method !== "POST") {
    return json({ errors: { backup: ["请使用 POST 上传备份 ZIP。"] } }, 405);
  }
  try {
    const form = await request.formData();
    const upload = form.get("backup");
    const imported = await importBackupZip(env, upload);
    return json({ imported, stats: await archiveStats(env) });
  } catch (error) {
    return json({ errors: { backup: [error?.message || "导入失败，请确认备份文件完整后再试。"] } }, 400);
  }
}

async function importBackupZip(env, upload) {
  if (!isUploadedFile(upload)) {
    throw new Error("请选择要导入的备份 ZIP 文件。");
  }
  if (!upload.size) {
    throw new Error("上传的备份文件是空的。");
  }
  if (!env.MEDIA) {
    throw new Error("Sites R2 media binding is not available yet.");
  }

  let zip;
  try {
    zip = await readZipFile(upload);
  } catch (error) {
    throw new Error(error?.message || "请上传有效的备份 ZIP 文件。");
  }

  const manifest = await readBackupJson(zip, "manifest.json");
  if (manifest.app !== "Memoirs" || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("请上传由本应用导出的备份 ZIP。");
  }
  const memoirsPayload = await readBackupJson(zip, "memoirs.json");
  const prepared = await prepareBackupMemoirs(zip, memoirsPayload.memoirs);
  const writtenKeys = [];
  const insertedMemoirIds = [];
  let importedMedia = 0;

  try {
    for (const record of prepared) {
      const memoirId = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO memoirs (id, title, story, memory_date, location, mood, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
      ).bind(memoirId, record.title, record.story, record.memoryDate, record.location, record.mood, now, now).run();
      insertedMemoirIds.push(memoirId);

      for (const media of record.media) {
        const mediaId = crypto.randomUUID();
        const objectKey = `memoirs/${memoirId}/${mediaId}-${media.storageFilename}`;
        const bytes = await zip.read(media.archivePath);
        await env.MEDIA.put(objectKey, bytes, {
          httpMetadata: { contentType: media.mimeType || "application/octet-stream" },
        });
        writtenKeys.push(objectKey);
        await env.DB.prepare(
          `INSERT INTO media_items (memoir_id, object_key, original_filename, media_type, mime_type, size, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(memoirId, objectKey, media.originalFilename, media.mediaType, media.mimeType, media.fileSize, new Date().toISOString()).run();
        importedMedia += 1;
      }
    }
  } catch (error) {
    for (const key of writtenKeys) {
      try {
        await env.MEDIA.delete(key);
      } catch {}
    }
    for (const id of insertedMemoirIds) {
      try {
        await env.DB.prepare("DELETE FROM media_items WHERE memoir_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM memoirs WHERE id = ?").bind(id).run();
      } catch {}
    }
    throw new Error(error?.message || "服务器保存备份媒体失败，可能是云端存储空间不足。");
  }

  return { memoirs: prepared.length, media: importedMedia };
}

async function readBackupJson(zip, memberName) {
  if (!zip.has(memberName)) {
    throw new Error(`备份文件缺少 ${memberName}。`);
  }
  try {
    const text = new TextDecoder().decode(await zip.read(memberName));
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error();
    }
    return payload;
  } catch (error) {
    throw new Error(`${memberName} 不是有效的 JSON。`);
  }
}

async function prepareBackupMemoirs(zip, memoirsPayload) {
  if (!Array.isArray(memoirsPayload)) {
    throw new Error("memoirs.json 缺少回忆列表。");
  }

  const prepared = [];
  let memoirIndex = 0;
  for (const memoirRecord of memoirsPayload) {
    memoirIndex += 1;
    if (!memoirRecord || typeof memoirRecord !== "object" || Array.isArray(memoirRecord)) {
      throw new Error("memoirs.json 中存在格式不正确的回忆记录。");
    }
    const mediaRecords = memoirRecord.media || [];
    if (!Array.isArray(mediaRecords)) {
      throw new Error("备份回忆中的媒体列表格式不正确。");
    }

    const media = [];
    let mediaIndex = 0;
    for (const mediaRecord of mediaRecords) {
      mediaIndex += 1;
      if (!mediaRecord || typeof mediaRecord !== "object" || Array.isArray(mediaRecord)) {
        throw new Error("备份回忆中的媒体记录格式不正确。");
      }
      const archivePath = cleanBackupArchivePath(mediaRecord.archivePath);
      const entry = zip.entry(archivePath);
      if (!entry) {
        throw new Error(`备份缺少媒体文件：${archivePath}`);
      }
      if (entry.directory) {
        throw new Error(`备份媒体路径不是文件：${archivePath}`);
      }

      const originalFilename = backupText(mediaRecord.originalFilename, 255) || archivePath.split("/").pop() || `media-${memoirIndex}-${mediaIndex}`;
      const storageFilename = safeFilename(originalFilename).slice(0, 120) || `media-${memoirIndex}-${mediaIndex}`;
      const { mediaType, mimeType } = backupMediaClassification(mediaRecord, originalFilename);
      media.push({
        archivePath,
        originalFilename,
        storageFilename,
        mediaType,
        mimeType,
        fileSize: entry.uncompressedSize,
      });
    }

    prepared.push({
      title: backupText(memoirRecord.title, 120) || `导入的回忆 ${memoirIndex}`,
      story: backupText(memoirRecord.story, null, false),
      memoryDate: backupImportDate(memoirRecord.memoryDate),
      location: backupText(memoirRecord.location, 120),
      mood: backupText(memoirRecord.mood, 60),
      media,
    });
  }
  return prepared;
}

function cleanBackupArchivePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("备份媒体缺少文件路径。");
  }
  const text = value.replaceAll("\\", "/").trim();
  const parts = text.split("/");
  if (text.startsWith("/") || text.endsWith("/") || !text.startsWith("media/") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("备份媒体文件路径不安全。");
  }
  return text;
}

function backupText(value, maxLength = null, strip = true) {
  let text = value === null || value === undefined ? "" : String(value);
  if (strip) text = text.trim();
  return maxLength === null ? text : text.slice(0, maxLength);
}

function backupImportDate(value) {
  const text = backupText(value);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`备份中存在无法识别的回忆日期：${text}`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`备份中存在无法识别的回忆日期：${text}`);
  }
  return text;
}

function backupMediaClassification(record, originalFilename) {
  const explicitType = backupText(record.mediaType);
  const guessedMime = guessMimeType(originalFilename);
  const mimeType = backupText(record.mimeType) || guessedMime || "";
  const extension = fileExtension(originalFilename);
  if (explicitType === "image" || explicitType === "video") {
    return { mediaType: explicitType, mimeType };
  }
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return { mediaType: "image", mimeType };
  }
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return { mediaType: "video", mimeType };
  }
  throw new Error(`备份中包含不支持的媒体类型：${originalFilename}`);
}

function guessMimeType(filename) {
  const extension = fileExtension(filename);
  const types = {
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".webm": "video/webm",
  };
  return types[extension] || "";
}

function fileExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.[^.\\/]+$/);
  return match ? match[0] : "";
}

async function readZipFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = parseZipEntries(data);
  let files;
  try {
    files = unzipSync(data);
  } catch (error) {
    throw new Error("请上传有效的备份 ZIP 文件。");
  }
  return {
    has(name) {
      return entries.has(name);
    },
    entry(name) {
      return entries.get(name) || null;
    },
    async read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`备份文件缺少 ${name}。`);
      const content = files[name];
      if (!content) throw new Error(`备份文件缺少 ${name}。`);
      return content;
    },
  };
}

function parseZipEntries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error("请上传有效的备份 ZIP 文件。");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("备份 ZIP 已损坏或无法读取。");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    entries.set(name, {
      name,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      directory: name.endsWith("/"),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
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
