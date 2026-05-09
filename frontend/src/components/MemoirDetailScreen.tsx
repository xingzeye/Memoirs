import { ArrowLeft, CalendarDays, Edit3, Heart, MapPin } from "lucide-react";
import { useState } from "react";
import { apiJson } from "../lib/api";
import type { AppSession, MediaItem, Memoir, Pagination } from "../lib/types";
import { Brand } from "./Brand";
import { MediaThumbnail } from "./MediaThumbnail";
import { MediaPreviewModal } from "./MediaPreviewModal";

type DetailPayload = {
  memoir?: Memoir;
  mediaPagination?: Pagination;
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

function mergeMediaItems(current: MediaItem[], incoming: MediaItem[]) {
  const seen = new Set(current.map((media) => media.id));
  const merged = [...current];
  for (const media of incoming) {
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    merged.push(media);
  }
  return merged;
}

const detailPaginationFallback: Pagination = { page: 1, pageSize: 60, hasMore: false, nextPage: null };

export function MemoirDetailScreen({ session, payload, onLogout }: MemoirDetailScreenProps) {
  const memoir = payload.memoir;
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(memoir?.media || []);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [pagination, setPagination] = useState<Pagination>(payload.mediaPagination || detailPaginationFallback);
  const [loadingMore, setLoadingMore] = useState(false);

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
  const currentMemoir = memoir;

  async function loadMoreMedia() {
    if (!pagination.hasMore || !pagination.nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(pagination.nextPage));
      params.set("pageSize", String(pagination.pageSize || 60));
      const data = await apiJson<{ media?: MediaItem[]; mediaCount?: number; pagination?: Pagination }>(
        `${currentMemoir.urls.media}${params.toString() ? `?${params}` : ""}`,
        session.csrfToken,
      );
      setMediaItems((current) => mergeMediaItems(current, data.media || []));
      setPagination(data.pagination || detailPaginationFallback);
    } finally {
      setLoadingMore(false);
    }
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
            {mediaItems.length ? (
              <>
                <div className="detail-media-grid">
                  {mediaItems.map((media) => (
                    <button key={media.id} type="button" onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}>
                      <MediaThumbnail media={media} />
                    </button>
                  ))}
                </div>
                {pagination.hasMore ? (
                  <div className="load-more-row">
                    <button className="quiet-button" type="button" onClick={loadMoreMedia} disabled={loadingMore}>
                      {loadingMore ? "加载中..." : "加载更多"}
                    </button>
                  </div>
                ) : null}
              </>
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
