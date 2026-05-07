import { ArrowLeft, CalendarDays, Edit3, Heart, MapPin } from "lucide-react";
import { useState } from "react";
import type { AppSession, MediaItem, Memoir } from "../lib/types";
import { Brand } from "./Brand";
import { MediaThumbnail } from "./MediaThumbnail";
import { MediaPreviewModal } from "./MediaPreviewModal";

type DetailPayload = {
  memoir?: Memoir;
};

type MemoirDetailScreenProps = {
  session: AppSession;
  payload: DetailPayload;
  onLogout: () => void;
};

function formatDate(memoir: Memoir) {
  if (!memoir.memoryDate) return memoir.dateLabel || "某一天";
  const parsed = new Date(`${memoir.memoryDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return memoir.dateLabel || memoir.memoryDate;
  return parsed.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export function MemoirDetailScreen({ session, payload, onLogout }: MemoirDetailScreenProps) {
  const memoir = payload.memoir;
  const [preview, setPreview] = useState<MediaItem | null>(null);

  if (!memoir) {
    return (
      <main className="app-shell detail-shell">
        <Brand session={session} onLogout={onLogout} />
        <section className="detail-main">
          <a className="detail-back-link" href={session.routes.memoirList || "/"}>
            <ArrowLeft size={16} />
            返回回忆库
          </a>
          <h1>没有找到这段回忆</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell detail-shell">
      <Brand session={session} onLogout={onLogout} />
      <section className="detail-layout">
        <article className="detail-main">
          <div className="detail-heading">
            <a className="detail-back-link" href={session.routes.memoirList || "/"}>
              <ArrowLeft size={16} />
              返回回忆库
            </a>
            <h1>{memoir.title}</h1>
            <div className="detail-meta" aria-label="回忆信息">
              <span>
                <CalendarDays size={15} />
                {formatDate(memoir)}
              </span>
              <span>
                <MapPin size={15} />
                {memoir.location || "未记录地点"}
              </span>
              <span>
                <Heart size={15} />
                {memoir.mood || "未标注"}
              </span>
            </div>
          </div>

          <section className="detail-section">
            <h2>正文</h2>
            <p className={`detail-story${memoir.story.trim() ? "" : " muted"}`}>{memoir.story.trim() || "这段回忆还没有正文。"}</p>
          </section>

          <section className="detail-section">
            <div className="detail-section-title">
              <h2>照片和视频</h2>
              <span>{memoir.mediaCount} 个文件</span>
            </div>
            {memoir.media.length ? (
              <div className="detail-media-grid">
                {memoir.media.map((media) => (
                  <button key={media.id} type="button" onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}>
                    <MediaThumbnail media={media} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="detail-empty">这段回忆还没有照片或视频。</p>
            )}
          </section>
        </article>

        <aside className="detail-side">
          <section>
            <h2>整理</h2>
            <a className="primary-button" href={memoir.urls.edit}>
              <Edit3 size={16} />
              编辑回忆
            </a>
          </section>
          <section>
            <h2>记录</h2>
            <dl className="detail-facts">
              <div>
                <dt>日期</dt>
                <dd>{memoir.dateLabel || "某一天"}</dd>
              </div>
              <div>
                <dt>地点</dt>
                <dd>{memoir.location || "未记录"}</dd>
              </div>
              <div>
                <dt>心情</dt>
                <dd>{memoir.mood || "未标注"}</dd>
              </div>
              <div>
                <dt>媒体</dt>
                <dd>{memoir.mediaCount} 个</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
      <MediaPreviewModal media={preview} onClose={() => setPreview(null)} />
    </main>
  );
}
