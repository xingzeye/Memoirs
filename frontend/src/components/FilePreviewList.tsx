import { Image, Video, X } from "lucide-react";
import { formatBytes } from "../lib/api";

type LocalFilePreview = {
  id: string;
  file: File;
  url: string;
};

type FilePreviewListProps = {
  files: LocalFilePreview[];
  onRemove: (id: string) => void;
};

export function FilePreviewList({ files, onRemove }: FilePreviewListProps) {
  if (!files.length) return null;

  return (
    <ul className="local-file-grid">
      {files.map((item) => {
        const isVideo = item.file.type.startsWith("video/");
        return (
          <li key={item.id}>
            <span className="local-file-thumb">
              {isVideo ? (
                <video src={item.url} muted preload="none" />
              ) : (
                <img src={item.url} alt={item.file.name} decoding="async" />
              )}
            </span>
            <span className="local-file-meta">
              <strong>{item.file.name}</strong>
              <small>
                {isVideo ? <Video size={13} /> : <Image size={13} />}
                {formatBytes(item.file.size)}
              </small>
            </span>
            <button className="icon-button" type="button" aria-label="移除文件" onClick={() => onRemove(item.id)}>
              <X size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type { LocalFilePreview };
