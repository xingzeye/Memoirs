import { Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "../lib/types";

type MediaThumbnailProps = {
  media: MediaItem;
  eager?: boolean;
};

export function MediaThumbnail({ media, eager = false }: MediaThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(eager);

  useEffect(() => {
    if (media.type !== "video" || shouldLoadVideo) return;
    const video = videoRef.current;
    if (!video || !("IntersectionObserver" in window)) {
      setShouldLoadVideo(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoadVideo(true);
        observer.disconnect();
      },
      { rootMargin: "360px 0px" },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [media.type, shouldLoadVideo]);

  if (media.type === "video") {
    return (
      <>
        <video ref={videoRef} src={shouldLoadVideo ? media.url : undefined} muted playsInline preload="metadata" />
        <span className="media-video-badge" aria-hidden="true">
          <Video size={16} />
        </span>
      </>
    );
  }

  return <img src={media.thumbnailUrl || media.url} alt={media.name} loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : "auto"} />;
}
