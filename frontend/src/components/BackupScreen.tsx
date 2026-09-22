import { useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, DatabaseBackup, Download, FileJson, FileText, Images, ShieldCheck, Upload } from "lucide-react";
import { apiForm, formatBytes } from "../lib/api";
import { importLargeBackup, type BackupImportProgress } from "../lib/largeBackupImport";
import type { AppSession, FormErrors } from "../lib/types";
import { Brand } from "./Brand";

type BackupPayload = {
  exportUrl?: string;
  importUrl?: string;
  largeImportUrl?: string;
  stats?: {
    memoirs: number;
    media: number;
    photos?: number;
    videos?: number;
  };
};

type BackupScreenProps = {
  session: AppSession;
  payload: BackupPayload;
  onLogout: () => void;
};

type BackupImportResponse = {
  imported?: {
    memoirs: number;
    media: number;
  };
  stats?: BackupPayload["stats"];
  redirect?: string;
};

export function BackupScreen({ session, payload, onLogout }: BackupScreenProps) {
  const [stats, setStats] = useState(payload.stats || { memoirs: 0, media: 0, photos: 0, videos: 0 });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<BackupImportResponse["imported"] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<BackupImportProgress | null>(null);
  const exportUrl = payload.exportUrl || session.routes.exportBackup || "/memoirs/export/";
  const importUrl = payload.importUrl || session.routes.importBackup || "/memoirs/import/";
  const importErrors = [...(errors.backup || []), ...(errors.__all__ || [])];
  const progressPercent = progress
    ? progress.totalBytes > 0
      ? Math.round((progress.uploadedBytes / progress.totalBytes) * 100)
      : progress.totalFiles > 0
        ? Math.round((progress.completedFiles / progress.totalFiles) * 100)
        : 0
    : 0;

  const submitImport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (isImporting) {
      return;
    }
    setErrors({});
    setResult(null);
    setProgress(null);

    if (!selectedFile) {
      setErrors({ backup: ["请选择一个从本应用导出的 ZIP 备份文件。"] });
      return;
    }

    setIsImporting(true);
    try {
      let response: BackupImportResponse;
      if (payload.largeImportUrl) {
        response = await importLargeBackup({
          file: selectedFile,
          startUrl: payload.largeImportUrl,
          csrfToken: session.csrfToken,
          onProgress: setProgress,
        });
      } else {
        const formData = new FormData();
        formData.append("backup", selectedFile);
        response = await apiForm<BackupImportResponse>(importUrl, session.csrfToken, formData);
      }
      setErrors({});
      setResult(response.imported || { memoirs: 0, media: 0 });
      if (response.stats) {
        setStats(response.stats);
      }
      setSelectedFile(null);
      setProgress(null);
      form.reset();
    } catch (error) {
      const payloadError = error as { errors?: FormErrors };
      setErrors(payloadError.errors || { __all__: ["导入失败，请确认备份文件完整后再试。"] });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <main className="app-shell backup-shell">
      <Brand session={session} onLogout={onLogout} />
      <section className="backup-page">
        <a className="detail-back-link" href={session.routes.memoirList || "/"}>
          <ArrowLeft size={16} />
          返回回忆库
        </a>

        <header className="backup-heading">
          <DatabaseBackup size={24} />
          <div>
            <h1>备份与导入</h1>
            <p>下载当前账号的完整备份，也可以把之前导出的 ZIP 作为新回忆导回当前账号。</p>
          </div>
        </header>

        <section className="backup-card">
          <div className="backup-card-copy">
            <h2>导出备份 ZIP</h2>
            <p>本次备份包含未进入回收站的 {stats.memoirs} 段回忆、{stats.photos || 0} 张照片和 {stats.videos || 0} 段视频。</p>
          </div>
          <a className="primary-button" href={exportUrl}>
            <Download size={16} />
            下载备份 ZIP
          </a>
        </section>

        <section className="backup-card backup-import-card">
          <div className="backup-card-copy">
            <h2>导入备份 ZIP</h2>
            <p>导入会新增回忆和媒体，不覆盖现有内容；回收站状态不会恢复，导入后的内容会作为正常回忆显示。</p>
          </div>
          <form className="backup-import-form" onSubmit={submitImport}>
            <label className="backup-file-input">
              <Upload size={16} />
              <span>{selectedFile ? selectedFile.name : "选择备份 ZIP"}</span>
              <input
                name="backup"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] || null);
                  setErrors({});
                  setResult(null);
                  setProgress(null);
                }}
              />
            </label>
            <button className="primary-button" type="submit" disabled={isImporting}>
              <Upload size={16} />
              {isImporting ? "正在导入..." : "导入备份"}
            </button>
          </form>
          {selectedFile && !isImporting ? <p className="backup-file-size">文件大小：{formatBytes(selectedFile.size)}</p> : null}
          {progress ? (
            <div className="backup-import-progress" aria-live="polite">
              <div className="backup-progress-copy">
                <strong>
                  {progress.phase === "reading"
                    ? "正在读取备份清单"
                    : progress.phase === "finalizing"
                      ? "正在完成导入"
                      : `正在上传 ${progress.completedFiles}/${progress.totalFiles}`}
                </strong>
                <span>
                  {progress.phase === "uploading"
                    ? `${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}${progress.currentName ? ` · ${progress.currentName}` : ""}`
                    : progress.phase === "finalizing"
                      ? "媒体已上传，正在写入回忆库"
                      : "只读取 ZIP 目录，不会一次上传整包"}
                </span>
              </div>
              <progress max={100} value={progress.phase === "finalizing" ? 100 : progressPercent}>
                {progressPercent}%
              </progress>
            </div>
          ) : null}
        </section>

        {importErrors.length ? (
          <div className="backup-message backup-message-error">
            <AlertCircle size={18} />
            <span>{importErrors.join(" ")}</span>
          </div>
        ) : null}

        {result ? (
          <div className="backup-message backup-message-success">
            <CheckCircle2 size={18} />
            <span>已导入 {result.memoirs} 段回忆和 {result.media} 个媒体文件。</span>
            <a href={session.routes.memoirList || "/"}>查看回忆库</a>
          </div>
        ) : null}

        <section className="backup-grid" aria-label="备份内容">
          <article>
            <FileJson size={20} />
            <h2>JSON 数据</h2>
            <p>保存回忆字段、时间、地点、心情和媒体元数据。</p>
          </article>
          <article>
            <FileText size={20} />
            <h2>Markdown 文档</h2>
            <p>每段回忆都会生成一份可直接阅读的文档。</p>
          </article>
          <article>
            <Images size={20} />
            <h2>原始媒体</h2>
            <p>照片和视频会按回忆编号归档到备份包中。</p>
          </article>
          <article>
            <ShieldCheck size={20} />
            <h2>私密范围</h2>
            <p>只导出当前账号的正常回忆，回收站内容不会包含在内。</p>
          </article>
        </section>
      </section>
    </main>
  );
}
