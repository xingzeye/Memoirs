import { BookOpen, Download, X } from "lucide-react";
import type { MediaItem } from "../lib/types";

type MediaPreviewModalProps = {
  media: MediaItem | null;
  onClose: () => void;
};

export function MediaPreviewModal({ media, onClose }: MediaPreviewModalProps) {
  if (!media) return null;

  return (
    <div className="preview-layer" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <section className="preview-frame" onMouseDown={(event) => event.stopPropagation()}>
        <div className="preview-actions">
          {media.memoirUrl ? (
            <a className="preview-download-button" href={media.memoirUrl} aria-label="查看所属回忆">
              <BookOpen size={16} />
              <span>查看回忆</span>
            </a>
          ) : null}
          <a className="preview-download-button" href={media.downloadUrl || media.url} download aria-label={media.type === "video" ? "下载原视频" : "下载原图"}>
            <Download size={16} />
            <span>{media.type === "video" ? "下载原视频" : "下载原图"}</span>
          </a>
          <button className="icon-button close-button" type="button" aria-label="关闭预览" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {media.type === "video" ? (
          <video src={media.url} controls autoPlay playsInline preload="auto" />
        ) : (
          <img src={media.url} alt={media.name} />
        )}
      </section>
    </div>
  );
}
