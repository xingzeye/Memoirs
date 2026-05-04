import { CheckCircle2, ImagePlus, QrCode, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiForm } from "../lib/api";
import type { AppSession, FormErrors, MediaItem, MobileUploadSession } from "../lib/types";
import { Brand } from "./Brand";
import { FilePreviewList, type LocalFilePreview } from "./FilePreviewList";

type EditorPayload = {
  mode?: "create" | "edit";
  memoir?: { id: string; title: string } | null;
  form?: {
    values?: Record<string, string>;
    errors?: FormErrors;
  };
  mobileUpload?: MobileUploadSession;
  existingMedia?: MediaItem[];
  apiSubmitUrl?: string;
};

type MemoirEditorScreenProps = {
  session: AppSession;
  payload: EditorPayload;
  onLogout: () => void;
};

export function MemoirEditorScreen({ session, payload, onLogout }: MemoirEditorScreenProps) {
  const mode = payload.mode || "create";
  const values = payload.form?.values || {};
  const [errors, setErrors] = useState<FormErrors>(payload.form?.errors || {});
  const [files, setFiles] = useState<LocalFilePreview[]>([]);
  const [deleteMedia, setDeleteMedia] = useState<Set<number>>(new Set());
  const [mobileUpload, setMobileUpload] = useState(payload.mobileUpload);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!mobileUpload?.statusUrl || !mobileUpload.active) return;
    const poll = window.setInterval(async () => {
      const response = await fetch(mobileUpload.statusUrl, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const data = await response.json();
      setMobileUpload((current) => (current ? { ...current, ...data, items: data.items || [] } : current));
    }, 5000);
    return () => window.clearInterval(poll);
  }, [mobileUpload?.statusUrl, mobileUpload?.active]);

  useEffect(() => {
    return () => files.forEach((file) => URL.revokeObjectURL(file.url));
  }, [files]);

  const title = mode === "edit" ? "修改回忆" : "新增回忆";
  const storyHint = mode === "edit" ? "调整文字、日期和照片，让这段旧时光保持完整。" : "写下那天的地点、心情和你想保存的细节。";

  function onFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []).map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setFiles((current) => [...current, ...selected]);
    event.target.value = "";
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const target = current.find((file) => file.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((file) => file.id !== id);
    });
  }

  function toggleDelete(id: number) {
    setDeleteMedia((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const formData = new FormData(event.currentTarget);
    files.forEach(({ file }) => formData.append("media", file));
    deleteMedia.forEach((id) => formData.append("delete_media", String(id)));
    if (mobileUpload?.token) formData.set("mobile_upload_token", mobileUpload.token);

    try {
      const response = await apiForm<{ redirect: string }>(payload.apiSubmitUrl || session.routes.memoirs || "", session.csrfToken, formData);
      window.location.assign(response.redirect || session.routes.memoirList || "/");
    } catch (error) {
      const payloadError = error as { errors?: FormErrors };
      setErrors(payloadError.errors || { __all__: ["保存失败，请检查表单。"] });
    } finally {
      setPending(false);
    }
  }

  const existingMedia = useMemo(() => payload.existingMedia || [], [payload.existingMedia]);

  return (
    <main className="app-shell editor-shell">
      <Brand session={session} onLogout={onLogout} />
      <form className="editor-layout" onSubmit={submit}>
        <section className="editor-main">
          <div className="editor-heading">
            <a href={session.routes.memoirList || "/"}>回忆库</a>
            <h1>{title}</h1>
            <p>{storyHint}</p>
          </div>

          {errors.__all__?.length ? <div className="form-alert">{errors.__all__.join(" ")}</div> : null}

          <label className="field-block">
            <span>标题</span>
            <input name="title" defaultValue={values.title || ""} placeholder="比如：某一天" required />
            {errors.title?.map((message) => <small key={message}>{message}</small>)}
          </label>

          <div className="editor-grid">
            <label className="field-block">
              <span>日期</span>
              <input name="memory_date" type="date" defaultValue={values.memory_date || ""} />
              {errors.memory_date?.map((message) => <small key={message}>{message}</small>)}
            </label>
            <label className="field-block">
              <span>地点</span>
              <input name="location" defaultValue={values.location || ""} placeholder="厦门 · 鼓浪屿" />
              {errors.location?.map((message) => <small key={message}>{message}</small>)}
            </label>
            <label className="field-block">
              <span>心情</span>
              <input name="mood" defaultValue={values.mood || ""} placeholder="想念、温柔、释怀" />
              {errors.mood?.map((message) => <small key={message}>{message}</small>)}
            </label>
          </div>

          <label className="field-block">
            <span>故事（正文）</span>
            <textarea name="story" defaultValue={values.story || ""} rows={8} placeholder="写下你想保存的细节。" />
            {errors.story?.map((message) => <small key={message}>{message}</small>)}
          </label>

          {existingMedia.length ? (
            <section className="existing-media-panel">
              <h2>已有媒体</h2>
              <p>勾选后保存，会从这段回忆里移除对应文件。</p>
              <div className="existing-media-grid">
                {existingMedia.map((media) => (
                  <button className={deleteMedia.has(media.id) ? "marked-delete" : ""} key={media.id} type="button" onClick={() => toggleDelete(media.id)}>
                    {media.type === "video" ? <video src={media.url} muted preload="metadata" /> : <img src={media.url} alt={media.name} loading="lazy" />}
                    <span>
                      <Trash2 size={14} />
                      {deleteMedia.has(media.id) ? "将删除" : "保留"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="upload-panel">
            <label className="drop-target">
              <ImagePlus size={24} />
              <strong>{mode === "edit" ? "追加照片或视频" : "选择照片或视频"}</strong>
              <span>支持 JPG / PNG / MP4 / MOV，可一次选择多个文件</span>
              <input type="file" accept="image/*,video/*" multiple onChange={onFilesSelected} />
            </label>
            <FilePreviewList files={files} onRemove={removeFile} />
          </section>
        </section>

        <aside className="editor-side">
          <div className="editor-actions">
            <a className="quiet-button" href={session.routes.memoirList || "/"}>
              取消
            </a>
            <button className="primary-button" type="submit" disabled={pending}>
              <Save size={16} />
              {pending ? "保存中..." : mode === "edit" ? "保存修改" : "保存回忆"}
            </button>
          </div>

          <section className="qr-card">
            <QrCode size={20} />
            <h2>用手机上传照片或视频</h2>
            <p>微信扫一扫二维码，从手机相册选择文件。</p>
            <div className="qr-box">
              {mobileUpload?.qrDataUri ? <img src={mobileUpload.qrDataUri} alt="手机上传二维码" /> : <span>二维码生成失败</span>}
            </div>
            <a href={mobileUpload?.uploadUrl || "#"} target="_blank" rel="noreferrer">
              上传到电脑页面
            </a>
          </section>

          <section className="phone-status-card">
            <h2>手机上传状态</h2>
            {mobileUpload?.items?.length ? (
              <ul>
                {mobileUpload.items.map((item) => (
                  <li key={item.id}>
                    <CheckCircle2 size={15} />
                    <span>{item.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>还没有从手机上传的文件。</p>
            )}
          </section>
        </aside>
      </form>
    </main>
  );
}
