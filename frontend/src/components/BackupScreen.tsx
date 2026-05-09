import { ArrowLeft, DatabaseBackup, Download, FileJson, FileText, Images, ShieldCheck } from "lucide-react";
import type { AppSession } from "../lib/types";
import { Brand } from "./Brand";

type BackupPayload = {
  exportUrl?: string;
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

export function BackupScreen({ session, payload, onLogout }: BackupScreenProps) {
  const stats = payload.stats || { memoirs: 0, media: 0, photos: 0, videos: 0 };
  const exportUrl = payload.exportUrl || session.routes.exportBackup || "/memoirs/export/";

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
            <h1>备份导出</h1>
            <p>下载一份属于当前账号的完整备份，包含可读文档、结构化数据和原始媒体文件。</p>
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
