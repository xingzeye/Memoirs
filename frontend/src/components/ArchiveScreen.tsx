import {
  Archive,
  CalendarDays,
  ChevronDown,
  Clock3,
  Edit3,
  Heart,
  Image,
  Images,
  LayoutList,
  LogOut,
  Mail,
  MapPin,
  Plus,
  Search,
  Settings,
  Trash2,
  Video,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { apiJson } from "../lib/api";
import type { AppSession, MediaItem, Memoir } from "../lib/types";
import { MediaPreviewModal } from "./MediaPreviewModal";

type ArchiveStats = {
  memoirs: number;
  media: number;
  photos?: number;
  videos?: number;
};

type ArchivePayload = {
  memoirs?: Memoir[];
  query?: string;
  activeMood?: string;
  moodChoices?: string[];
  stats?: ArchiveStats;
};

type ArchiveScreenProps = {
  session: AppSession;
  payload: ArchivePayload;
  onLogout: () => void;
};

const fallbackMoods = ["想念", "温柔", "释怀", "感谢"];
const sidebarItems = [
  { label: "记忆中的TA", icon: Archive },
  { label: "时间线", icon: Clock3 },
  { label: "地点", icon: MapPin },
  { label: "心情", icon: Heart },
  { label: "信笺", icon: Mail },
  { label: "媒体", icon: Images },
  { label: "回收站", icon: Trash2 },
];

type SidebarSection = (typeof sidebarItems)[number]["label"];
type SortOrder = "desc" | "asc";
type ViewMode = "timeline" | "media";
type OpenPanel = "profile" | null;

function countMemoirMedia(memoir: Memoir) {
  return memoir.media.reduce(
    (counts, media) => {
      if (media.type === "video") counts.videos += 1;
      else counts.photos += 1;
      counts.media += 1;
      return counts;
    },
    { media: 0, photos: 0, videos: 0 },
  );
}

function deriveStats(stats: ArchiveStats | undefined, memoirs: Memoir[]): Required<ArchiveStats> {
  const mediaTotals = memoirs.reduce(
    (counts, memoir) => {
      const next = countMemoirMedia(memoir);
      counts.media += next.media;
      counts.photos += next.photos;
      counts.videos += next.videos;
      return counts;
    },
    { media: 0, photos: 0, videos: 0 },
  );

  return {
    memoirs: stats?.memoirs ?? memoirs.length,
    media: stats?.media ?? mediaTotals.media,
    photos: stats?.photos ?? mediaTotals.photos,
    videos: stats?.videos ?? mediaTotals.videos,
  };
}

function dateParts(memoir: Memoir) {
  if (!memoir.memoryDate) {
    return { year: "日期", day: "某一天", week: "未记录" };
  }

  const [year, month, day] = memoir.memoryDate.split("-");
  const parsed = new Date(`${memoir.memoryDate}T00:00:00`);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  return {
    year,
    day: month && day ? `${month}-${day}` : memoir.dateLabel,
    week: Number.isNaN(parsed.getTime()) ? "旧时光" : weekdays[parsed.getDay()],
  };
}

function moodClassName(mood: string) {
  if (["想念", "思念"].includes(mood)) return "mood-chip mood-chip-coral";
  if (["温柔", "平静"].includes(mood)) return "mood-chip mood-chip-teal";
  if (["释怀", "放下"].includes(mood)) return "mood-chip mood-chip-sage";
  if (["感谢", "珍惜"].includes(mood)) return "mood-chip mood-chip-gold";
  return "mood-chip";
}

function memoirTimeValue(memoir: Memoir) {
  const value = memoir.memoryDate || memoir.createdAt || memoir.updatedAt || "";
  const parsed = value ? new Date(value.includes("T") ? value : `${value}T00:00:00`).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function filterBySection(section: SidebarSection, memoirs: Memoir[]) {
  if (section === "时间线") return memoirs.filter((memoir) => memoir.memoryDate);
  if (section === "地点") return memoirs.filter((memoir) => memoir.location);
  if (section === "心情") return memoirs.filter((memoir) => memoir.mood);
  if (section === "信笺") return memoirs.filter((memoir) => memoir.story.trim());
  if (section === "媒体") return memoirs.filter((memoir) => memoir.mediaCount > 0);
  if (section === "回收站") return [];
  return memoirs;
}

function emptyCopy(section: SidebarSection) {
  if (section === "时间线") return { title: "还没有日期记录", body: "给回忆补上日期后，它们会出现在时间线里。" };
  if (section === "地点") return { title: "还没有地点记录", body: "给回忆补上地点后，这里会更像一份旧时光地图。" };
  if (section === "心情") return { title: "还没有心情标签", body: "写下心情后，可以在这里快速看见那些时刻的颜色。" };
  if (section === "信笺") return { title: "还没有信笺正文", body: "有正文的回忆会在这里集中呈现。" };
  if (section === "媒体") return { title: "还没有媒体", body: "上传照片或视频后，这里会成为你的影像档案。" };
  if (section === "回收站") return { title: "回收站暂无内容", body: "当前没有可显示的已删除记录。" };
  return { title: "还没有回忆", body: "先新增一段吧，把照片、地点和那天的心情慢慢收好。" };
}

export function ArchiveScreen({ session, payload, onLogout }: ArchiveScreenProps) {
  const [memoirs, setMemoirs] = useState<Memoir[]>(payload.memoirs || []);
  const [stats, setStats] = useState(() => deriveStats(payload.stats, payload.memoirs || []));
  const [query, setQuery] = useState(payload.query || "");
  const [activeMood, setActiveMood] = useState(payload.activeMood || "");
  const [activeSection, setActiveSection] = useState<SidebarSection>("记忆中的TA");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const moods = useMemo(() => {
    const source = payload.moodChoices?.length ? payload.moodChoices : fallbackMoods;
    return Array.from(new Set(source));
  }, [payload.moodChoices]);

  async function refresh(nextQuery = query, nextMood = activeMood) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextMood) params.set("mood", nextMood);
    const url = `${session.routes.memoirs || "/api/memoirs/"}${params.toString() ? `?${params}` : ""}`;
    const data = await apiJson<ArchivePayload>(url, session.csrfToken);
    setMemoirs(data.memoirs || []);
    setStats(deriveStats(data.stats, data.memoirs || []));
  }

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSection("记忆中的TA");
    await refresh();
  }

  async function chooseMood(mood: string) {
    setActiveSection("记忆中的TA");
    setActiveMood(mood);
    await refresh(query, mood);
  }

  async function chooseSection(section: SidebarSection) {
    setOpenPanel(null);
    setActiveSection(section);

    if (section === "记忆中的TA") {
      setQuery("");
      setActiveMood("");
      await refresh("", "");
      return;
    }

    if (section === "时间线") {
      setViewMode("timeline");
      setSortOrder("desc");
      return;
    }

    if (section === "地点") {
      searchInputRef.current?.focus();
      return;
    }
  }

  async function deleteMemoir(memoir: Memoir) {
    if (!window.confirm("确定删除这段回忆和它的媒体文件吗？")) return;
    setPendingDelete(memoir.id);
    try {
      await apiJson(memoir.urls.apiDelete, session.csrfToken, {});
      setMemoirs((items) => items.filter((item) => item.id !== memoir.id));
      const removed = countMemoirMedia(memoir);
      setStats((current) => ({
        memoirs: Math.max(current.memoirs - 1, 0),
        media: Math.max(current.media - removed.media, 0),
        photos: Math.max(current.photos - removed.photos, 0),
        videos: Math.max(current.videos - removed.videos, 0),
      }));
    } finally {
      setPendingDelete("");
    }
  }

  function toggleSortOrder() {
    setSortOrder((current) => (current === "desc" ? "asc" : "desc"));
  }

  function toggleViewMode() {
    setViewMode((current) => (current === "timeline" ? "media" : "timeline"));
  }

  function togglePanel(panel: Exclude<OpenPanel, null>) {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  const visibleMemoirs = useMemo(() => {
    return filterBySection(activeSection, memoirs).slice().sort((left, right) => {
      const diff = memoirTimeValue(left) - memoirTimeValue(right);
      return sortOrder === "desc" ? -diff : diff;
    });
  }, [activeSection, memoirs, sortOrder]);

  const emptyState = emptyCopy(activeSection);
  const userInitial = session.user?.username ? session.user.username.slice(0, 1).toUpperCase() : "TA";
  const sortLabel = sortOrder === "desc" ? "时间最新" : "时间最早";
  const viewLabel = viewMode === "timeline" ? "媒体视图" : "列表视图";

  return (
    <main className="archive-workbench">
      <aside className="archive-sidebar" aria-label="回忆库导航">
        <a className="sidebar-brand" href={session.routes.memoirList || "/"}>
          <span className="sidebar-brand-mark" aria-hidden="true">
            <Archive size={18} strokeWidth={1.8} />
          </span>
          <span>忆往昔</span>
        </a>

        <nav className="sidebar-nav">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={`sidebar-nav-item${activeSection === item.label ? " active" : ""}`} key={item.label} type="button" onClick={() => chooseSection(item.label)}>
                <Icon size={16} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-nav-item" type="button" onClick={() => togglePanel("profile")}>
            <Settings size={16} strokeWidth={1.8} />
            <span>设置</span>
          </button>
          <button className="sidebar-nav-item" type="button" onClick={onLogout}>
            <LogOut size={16} strokeWidth={1.8} />
            <span>退出</span>
          </button>
        </div>
      </aside>

      <section className="archive-content">
        <header className="archive-pagebar">
          <div className="archive-heading">
            <h1>记忆中的TA</h1>
            <p>
              {stats.memoirs} 段回忆
              <span>·</span>
              {stats.photos} 张照片
              <span>·</span>
              {stats.videos} 段视频
            </p>
          </div>

          <form className="archive-search" onSubmit={submitSearch}>
            <Search size={15} />
            <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、地点、正文或心情" />
            <button type="submit" aria-label="搜索">
              <Search size={15} />
            </button>
          </form>

          <div className="archive-utility">
            <a className="header-icon-button" href={session.routes.memoirCreate || "/memoirs/new/"} aria-label="新增回忆">
              <Plus size={16} />
            </a>
            <button className="archive-avatar" type="button" onClick={() => togglePanel("profile")} aria-label="账号菜单" aria-expanded={openPanel === "profile"}>
              <span>{userInitial}</span>
            </button>
            {openPanel ? (
              <div className="archive-popover" role="status">
                <strong>{session.user?.username || "当前账号"}</strong>
                <p>私人回忆库已登录。</p>
                <button type="button" onClick={onLogout}>
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <section className="archive-control-row" aria-label="回忆筛选">
          <div className="mood-tabs">
            <button className={!activeMood ? "active" : ""} type="button" onClick={() => chooseMood("")}>
              全部
            </button>
            {moods.map((mood) => (
              <button className={activeMood === mood ? "active" : ""} key={mood} type="button" onClick={() => chooseMood(mood)}>
                {mood}
              </button>
            ))}
          </div>

          <div className="archive-view-tools">
            <button className="sort-button" type="button" onClick={toggleSortOrder} aria-pressed={sortOrder === "asc"}>
              {sortLabel}
              <ChevronDown size={14} />
            </button>
            <button className={`view-button${viewMode === "media" ? " active" : ""}`} type="button" aria-label={viewLabel} aria-pressed={viewMode === "media"} onClick={toggleViewMode}>
              <LayoutList size={16} />
            </button>
          </div>
        </section>

        {visibleMemoirs.length ? (
          <section className={`archive-timeline ${viewMode === "media" ? "media-view" : ""}`} aria-label="回忆列表">
            {visibleMemoirs.map((memoir) => {
              const parts = dateParts(memoir);
              const mediaSlots = memoir.media.slice(0, viewMode === "media" ? 3 : 2);
              const rowClassName = `timeline-row media-count-${mediaSlots.length}${mediaSlots.length ? "" : " no-media"}`;
              return (
                <article className={rowClassName} key={memoir.id}>
                  <time className="timeline-date" dateTime={memoir.memoryDate || undefined}>
                    <span>{parts.year}</span>
                    <strong>{parts.day}</strong>
                    <small>{parts.week}</small>
                  </time>

                  {mediaSlots.length ? (
                    <div className="timeline-media-strip">
                      {mediaSlots.map((media) => (
                        <button key={media.id} type="button" onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}>
                          {media.type === "video" ? <video src={media.url} muted preload="metadata" /> : <img src={media.url} alt={media.name} loading="lazy" />}
                          {media.type === "video" ? <Video size={16} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="timeline-copy">
                    <h2>{memoir.title}</h2>
                    <p>{memoir.excerpt || "这段回忆还没有正文，先把照片和日期替你保存好。"}</p>
                  </div>

                  <div className={`timeline-location${memoir.location ? "" : " muted"}`}>
                    <span>{memoir.location || "未记录地点"}</span>
                  </div>

                  <div className="timeline-mood">{memoir.mood ? <span className={moodClassName(memoir.mood)}>{memoir.mood}</span> : <span className="mood-chip muted">未标注</span>}</div>

                  <div className="timeline-count" aria-label={`${memoir.mediaCount} 个媒体`}>
                    <Image size={14} />
                    <span>{memoir.mediaCount}</span>
                  </div>

                  <div className="timeline-actions">
                    <a className="timeline-icon-button" href={memoir.urls.edit} aria-label="修改">
                      <Edit3 size={15} />
                    </a>
                    <button className="timeline-icon-button danger" type="button" aria-label="删除" onClick={() => deleteMemoir(memoir)} disabled={pendingDelete === memoir.id}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="archive-empty-state">
            <CalendarDays size={30} />
            <h2>{emptyState.title}</h2>
            <p>{emptyState.body}</p>
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
