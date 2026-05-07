import { ArrowLeft, Images } from "lucide-react";
import { useState } from "react";
import type { AppSession, MediaItem } from "../lib/types";
import { Brand } from "./Brand";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { MediaThumbnail } from "./MediaThumbnail";

type MediaGalleryPayload = {
  media?: MediaItem[];
  stats?: {
    media: number;
    photos?: number;
    videos?: number;
  };
};

type MediaGalleryScreenProps = {
  session: AppSession;
  payload: MediaGalleryPayload;
  onLogout: () => void;
};

export function MediaGalleryScreen({ session, payload, onLogout }: MediaGalleryScreenProps) {
  const mediaItems = payload.media || [];
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const stats = payload.stats || { media: mediaItems.length };

  return (
    <main className="app-shell media-gallery-shell">
      <Brand session={session} onLogout={onLogout} />
      <section className="media-gallery-page">
        <header className="media-gallery-heading">
          <a className="detail-back-link" href={session.routes.memoirList || "/"}>
            <ArrowLeft size={16} />
            返回回忆库
          </a>
          <div>
            <Images size={22} />
            <h1>照片和视频</h1>
            <span>{stats.media} 个文件</span>
          </div>
        </header>

        {mediaItems.length ? (
          <div className="media-gallery-grid" aria-label="全部照片和视频">
            {mediaItems.map((media, index) => (
              <button key={media.id} type="button" onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}>
                <MediaThumbnail media={media} eager={index < 4} />
              </button>
            ))}
          </div>
        ) : (
          <section className="archive-empty-state">
            <Images size={30} />
            <h2>还没有照片和视频</h2>
            <a className="primary-button" href={session.routes.memoirCreate || "/memoirs/new/"}>
              新增回忆
            </a>
          </section>
        )}
      </section>
      <MediaPreviewModal media={preview} onClose={() => setPreview(null)} />
    </main>
  );
}
