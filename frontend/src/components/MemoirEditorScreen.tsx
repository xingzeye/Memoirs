import { Bold, CheckCircle2, Code2, Eye, Heading2, ImagePlus, Italic, List, Pilcrow, QrCode, Quote, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiForm } from "../lib/api";
import type { AppSession, FormErrors, MediaItem, MobileUploadSession } from "../lib/types";
import { Brand } from "./Brand";
import { FilePreviewList, type LocalFilePreview } from "./FilePreviewList";
import { MarkdownView } from "./MarkdownView";

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

const commonMoodOptions = ["想念", "温柔", "开心", "感动", "平静", "珍惜", "释怀", "遗憾", "期待", "难过", "感谢", "怀念"];

export function MemoirEditorScreen({ session, payload, onLogout }: MemoirEditorScreenProps) {
  const mode = payload.mode || "create";
  const values = payload.form?.values || {};
  const [errors, setErrors] = useState<FormErrors>(payload.form?.errors || {});
  const [files, setFiles] = useState<LocalFilePreview[]>([]);
  const [deleteMedia, setDeleteMedia] = useState<Set<number>>(new Set());
  const [mobileUpload, setMobileUpload] = useState(payload.mobileUpload);
  const [pending, setPending] = useState(false);
  const [storyValue, setStoryValue] = useState(values.story || "");
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
  const storyInputRef = useRef<HTMLTextAreaElement>(null);

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
  const moodOptions = useMemo(() => {
    const currentMood = values.mood || "";
    return currentMood && !commonMoodOptions.includes(currentMood) ? [currentMood, ...commonMoodOptions] : commonMoodOptions;
  }, [values.mood]);

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

  function insertMarkdown(prefix: string, suffix = "", fallback = "") {
    const input = storyInputRef.current;
    if (!input) {
      setStoryValue((current) => `${current}${prefix}${fallback}${suffix}`);
      return;
    }

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = storyValue.slice(start, end) || fallback;
    const nextValue = `${storyValue.slice(0, start)}${prefix}${selected}${suffix}${storyValue.slice(end)}`;
    setStoryValue(nextValue);

    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }

  function insertLineMarkdown(prefix: string, fallback: string) {
    const input = storyInputRef.current;
    if (!input) {
      setStoryValue((current) => `${current}${current ? "\n" : ""}${prefix}${fallback}`);
      return;
    }

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const lineStart = storyValue.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const selected = storyValue.slice(lineStart, end) || fallback;
    const nextLines = selected
      .split("\n")
      .map((line) => (line.trim() ? `${prefix}${line}` : line))
      .join("\n");
    const nextValue = `${storyValue.slice(0, lineStart)}${nextLines}${storyValue.slice(end)}`;
    setStoryValue(nextValue);

    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(lineStart + prefix.length, lineStart + nextLines.length);
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
              <select name="mood" defaultValue={values.mood || ""}>
                <option value="">未标注</option>
                {moodOptions.map((mood) => (
                  <option value={mood} key={mood}>
                    {mood}
                  </option>
                ))}
              </select>
              {errors.mood?.map((message) => <small key={message}>{message}</small>)}
            </label>
          </div>

          <label className="field-block markdown-field">
            <span className="field-label-row">
              <span>故事（Markdown）</span>
              <span className="markdown-toolbar" aria-label="Markdown 工具">
                <button type="button" title="标题" aria-label="插入标题" onClick={() => insertLineMarkdown("## ", "小标题")}>
                  <Heading2 size={15} />
                </button>
                <button type="button" title="粗体" aria-label="插入粗体" onClick={() => insertMarkdown("**", "**", "重点")}>
                  <Bold size={15} />
                </button>
                <button type="button" title="斜体" aria-label="插入斜体" onClick={() => insertMarkdown("*", "*", "心情")}>
                  <Italic size={15} />
                </button>
                <button type="button" title="列表" aria-label="插入列表" onClick={() => insertLineMarkdown("- ", "一件小事")}>
                  <List size={15} />
                </button>
                <button type="button" title="引用" aria-label="插入引用" onClick={() => insertLineMarkdown("> ", "那天想记住的话")}>
                  <Quote size={15} />
                </button>
                <button type="button" title="代码" aria-label="插入代码" onClick={() => insertMarkdown("`", "`", "code")}>
                  <Code2 size={15} />
                </button>
                <button type="button" title="预览" aria-label="切换预览" aria-pressed={showMarkdownPreview} onClick={() => setShowMarkdownPreview((current) => !current)}>
                  {showMarkdownPreview ? <Pilcrow size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </span>
            <textarea ref={storyInputRef} name="story" value={storyValue} onChange={(event) => setStoryValue(event.target.value)} rows={8} placeholder="写下你想保存的细节。" />
            {showMarkdownPreview ? (
              <div className="markdown-preview-panel">
                <MarkdownView value={storyValue} />
              </div>
            ) : null}
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
