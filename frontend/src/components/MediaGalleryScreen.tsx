import { ArrowLeft, CalendarDays, Images, MapPin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { apiJson } from "../lib/api";
import type { AppSession, MediaItem, Pagination } from "../lib/types";
import { Brand } from "./Brand";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { MediaThumbnail } from "./MediaThumbnail";

type GalleryFilters = {
  type?: "" | "image" | "video";
  year?: string;
  location?: string;
};

type GalleryGroup = {
  key: string;
  label: string;
  date: string;
  count: number;
  mediaIds: number[];
};

type MediaGalleryPayload = {
  media?: MediaItem[];
  groups?: GalleryGroup[];
  filters?: GalleryFilters;
  filterOptions?: {
    years?: string[];
    locations?: string[];
    types?: { value: "" | "image" | "video"; label: string }[];
  };
  stats?: {
    media: number;
    photos?: number;
    videos?: number;
  };
  pagination?: Pagination;
};

type MediaGalleryScreenProps = {
  session: AppSession;
  payload: MediaGalleryPayload;
  onLogout: () => void;
};

function deriveGroups(mediaItems: MediaItem[]): GalleryGroup[] {
  const groups: GalleryGroup[] = [];
  const groupIndex = new Map<string, GalleryGroup>();
  for (const media of mediaItems) {
    const key = media.memoryDate || "undated";
    let group = groupIndex.get(key);
    if (!group) {
      group = {
        key,
        label: media.dateLabel || "未记录日期",
        date: media.memoryDate || "",
        count: 0,
        mediaIds: [],
      };
      groupIndex.set(key, group);
      groups.push(group);
    }
    group.count += 1;
    group.mediaIds.push(media.id);
  }
  return groups;
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

const galleryPaginationFallback: Pagination = { page: 1, pageSize: 60, hasMore: false, nextPage: null };

export function MediaGalleryScreen({ session, payload, onLogout }: MediaGalleryScreenProps) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(payload.media || []);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [pagination, setPagination] = useState<Pagination>(payload.pagination || galleryPaginationFallback);
  const [loadingMore, setLoadingMore] = useState(false);
  const stats = payload.stats || { media: mediaItems.length, photos: 0, videos: 0 };
  const filters = payload.filters || {};
  const filterOptions = payload.filterOptions || {};
  const mediaById = useMemo(() => new Map(mediaItems.map((media) => [media.id, media])), [mediaItems]);
  const groups = useMemo(() => deriveGroups(mediaItems), [mediaItems]);
  const hasActiveFilters = Boolean(filters.type || filters.year || filters.location);

  function galleryUrl(nextFilters: GalleryFilters = {}) {
    const params = new URLSearchParams();
    const nextType = nextFilters.type ?? filters.type ?? "";
    const nextYear = nextFilters.year ?? filters.year ?? "";
    const nextLocation = nextFilters.location ?? filters.location ?? "";
    if (nextType) params.set("type", nextType);
    if (nextYear) params.set("year", nextYear);
    if (nextLocation) params.set("location", nextLocation);
    const base = session.routes.mediaGallery || "/memoirs/media/";
    return `${base}${params.toString() ? `?${params}` : ""}`;
  }

  function chooseFilter(nextFilters: GalleryFilters) {
    window.location.assign(galleryUrl(nextFilters));
  }

  async function loadMoreMedia() {
    if (!pagination.hasMore || !pagination.nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set("type", filters.type);
      if (filters.year) params.set("year", filters.year);
      if (filters.location) params.set("location", filters.location);
      params.set("page", String(pagination.nextPage));
      params.set("pageSize", String(pagination.pageSize || 60));
      const base = session.routes.mediaGalleryApi || "/api/memoirs/media/";
      const data = await apiJson<MediaGalleryPayload>(`${base}${params.toString() ? `?${params}` : ""}`, session.csrfToken);
      setMediaItems((current) => mergeMediaItems(current, data.media || []));
      setPagination(data.pagination || galleryPaginationFallback);
    } finally {
      setLoadingMore(false);
    }
  }

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
            <span>
              {stats.media} 个文件 · {stats.photos || 0} 张照片 · {stats.videos || 0} 段视频
            </span>
          </div>
        </header>

        <section className="media-gallery-filters" aria-label="相册筛选">
          <div className="gallery-type-tabs">
            {(filterOptions.types || [
              { value: "", label: "全部" },
              { value: "image", label: "照片" },
              { value: "video", label: "视频" },
            ]).map((option) => (
              <a className={(filters.type || "") === option.value ? "active" : ""} href={galleryUrl({ type: option.value })} key={option.value || "all"}>
                {option.label}
              </a>
            ))}
          </div>
          <label>
            <CalendarDays size={15} />
            <select value={filters.year || ""} onChange={(event) => chooseFilter({ year: event.target.value })}>
              <option value="">全部年份</option>
              {(filterOptions.years || []).map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            <MapPin size={15} />
            <select value={filters.location || ""} onChange={(event) => chooseFilter({ location: event.target.value })}>
              <option value="">全部地点</option>
              {(filterOptions.locations || []).map((location) => (
                <option value={location} key={location}>
                  {location}
                </option>
              ))}
            </select>
          </label>
          {hasActiveFilters ? (
            <a className="gallery-clear-filter" href={session.routes.mediaGallery || "/memoirs/media/"}>
              <X size={15} />
              清除筛选
            </a>
          ) : null}
        </section>

        {mediaItems.length ? (
          <>
            <div className="media-gallery-groups" aria-label="全部照片和视频">
              {groups.map((group, groupIndex) => {
                const groupMedia = group.mediaIds.map((id) => mediaById.get(id)).filter((media): media is MediaItem => Boolean(media));
                if (!groupMedia.length) return null;
                return (
                  <section className="media-gallery-group" key={group.key}>
                    <header>
                      <h2>{group.label}</h2>
                      <span>{group.count} 个文件</span>
                    </header>
                    <div className="media-gallery-grid">
                      {groupMedia.map((media, index) => (
                        <button key={media.id} type="button" onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}>
                          <MediaThumbnail media={media} eager={groupIndex === 0 && index < 4} />
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
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
          <section className="archive-empty-state">
            <Images size={30} />
            <h2>{hasActiveFilters ? "没有符合筛选的照片和视频" : "还没有照片和视频"}</h2>
            {hasActiveFilters ? (
              <a className="quiet-button" href={session.routes.mediaGallery || "/memoirs/media/"}>
                清除筛选
              </a>
            ) : null}
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
