import { X } from "lucide-react";
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
        <button className="icon-button close-button" type="button" aria-label="关闭预览" onClick={onClose}>
          <X size={18} />
        </button>
        {media.type === "video" ? (
          <video src={media.url} controls autoPlay />
        ) : (
          <img src={media.url} alt={media.name} />
        )}
        <p>{media.name}</p>
      </section>
    </div>
  );
}
