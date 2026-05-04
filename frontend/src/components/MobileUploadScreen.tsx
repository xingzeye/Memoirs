import { CheckCircle2, CloudUpload, ImagePlus, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { apiForm, formatBytes } from "../lib/api";
import type { AppSession, MobileUploadSession } from "../lib/types";
import { EmptyBrand } from "./Brand";
import { FilePreviewList, type LocalFilePreview } from "./FilePreviewList";

type MobileUploadPayload = {
  mobileUpload?: MobileUploadSession;
  errors?: string[];
  uploadedCount?: number;
};

type MobileUploadScreenProps = {
  session: AppSession;
  payload: MobileUploadPayload;
};

export function MobileUploadScreen({ session, payload }: MobileUploadScreenProps) {
  const [mobileUpload, setMobileUpload] = useState(payload.mobileUpload);
  const [errors, setErrors] = useState<string[]>(payload.errors || []);
  const [uploadedCount, setUploadedCount] = useState(payload.uploadedCount || 0);
  const [files, setFiles] = useState<LocalFilePreview[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => files.forEach((file) => URL.revokeObjectURL(file.url));
  }, [files]);

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mobileUpload?.uploadUrl || !files.length) {
      setErrors(["请选择照片或视频。"]);
      return;
    }
    setPending(true);
    setErrors([]);
    const formData = new FormData();
    files.forEach(({ file }) => formData.append("media", file));
    try {
      const response = await apiForm<MobileUploadPayload>(mobileUpload.uploadUrl, session.csrfToken, formData);
      setMobileUpload(response.mobileUpload);
      setUploadedCount(response.uploadedCount || files.length);
      files.forEach((file) => URL.revokeObjectURL(file.url));
      setFiles([]);
    } catch (error) {
      const payloadError = error as MobileUploadPayload;
      setErrors(payloadError.errors || ["上传失败，请稍后重试。"]);
      if (payloadError.mobileUpload) setMobileUpload(payloadError.mobileUpload);
    } finally {
      setPending(false);
    }
  }

  if (!mobileUpload) {
    return (
      <main className="phone-shell">
        <section className="phone-card">
          <EmptyBrand />
          <h1>上传链接不可用</h1>
          <p>请回到电脑页面重新生成二维码。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <EmptyBrand />
        <div className="phone-heading">
          <span>正在上传到：{mobileUpload.memoirTitle || "新的回忆"}</span>
          <h1>手机上传</h1>
          <p>{mobileUpload.active ? "选择手机相册里的照片或视频，上传后回到电脑页面继续保存。" : "这个上传链接已经过期或已完成。"}</p>
        </div>

        {uploadedCount ? (
          <div className="success-note">
            <CheckCircle2 size={16} />
            已上传 {uploadedCount} 个文件。
          </div>
        ) : null}
        {errors.length ? <div className="form-alert">{errors.join(" ")}</div> : null}

        {mobileUpload.active ? (
          <form onSubmit={submit}>
            <label className="drop-target phone-drop">
              <CloudUpload size={28} />
              <strong>点击选择，或拖拽上传</strong>
              <span>支持 JPG / PNG / MP4 / MOV</span>
              <input type="file" accept="image/*,video/*" multiple onChange={onFilesSelected} />
            </label>
            <FilePreviewList files={files} onRemove={removeFile} />
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? (
                <>
                  <RotateCw size={16} />
                  上传中...
                </>
              ) : (
                <>
                  <ImagePlus size={16} />
                  上传到电脑页面
                </>
              )}
            </button>
          </form>
        ) : null}

        <section className="uploaded-phone-list">
          <h2>已上传</h2>
          {mobileUpload.items.length ? (
            <ul>
              {mobileUpload.items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <small>{formatBytes(item.size)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无文件</p>
          )}
        </section>
      </section>
    </main>
  );
}
