export type AppPage = "auth" | "archive" | "backup" | "detail" | "editor" | "media-gallery" | "mobile-upload";

export type AppRoutes = {
  session?: string;
  login?: string;
  register?: string;
  logout?: string;
  memoirs?: string;
  mediaGalleryApi?: string;
  mobileUploadSessions?: string;
  memoirList?: string;
  memoirCreate?: string;
  mediaGallery?: string;
  backup?: string;
  exportBackup?: string;
  importBackup?: string;
  loginPage?: string;
  registerPage?: string;
};

export type AppSession = {
  user: { id: number; username: string; isStaff: boolean } | null;
  allowPublicRegistration: boolean;
  csrfToken: string;
  routes: AppRoutes;
  uploadLimits?: {
    maxRequestBytes?: number;
    maxMemoryFileBytes?: number;
  };
};

export type MediaItem = {
  id: number;
  url: string;
  absoluteUrl: string;
  thumbnailUrl?: string;
  downloadUrl: string;
  type: "image" | "video";
  name: string;
  mimeType: string;
  size: number;
  uploadedAt?: string;
  memoirId?: string;
  memoirTitle?: string;
  memoirUrl?: string;
  memoryDate?: string;
  dateLabel?: string;
  location?: string;
  mood?: string;
};

export type Pagination = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage?: number | null;
};

export type Memoir = {
  id: string;
  title: string;
  story: string;
  excerpt: string;
  memoryDate: string;
  dateLabel: string;
  location: string;
  mood: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  mediaCount: number;
  media: MediaItem[];
  urls: {
    detail: string;
    edit: string;
    delete: string;
    restore: string;
    destroy: string;
    api: string;
    media: string;
    apiDelete: string;
    apiRestore: string;
    apiDestroy: string;
  };
};

export type MobileUploadItem = {
  id: number;
  name: string;
  type: "image" | "video";
  size: number;
  uploaded_at: string;
  preview_url: string;
};

export type MobileUploadSession = {
  token: string;
  mode: "create" | "edit";
  memoirId: string;
  memoirTitle: string;
  uploadUrl: string;
  qrDataUri: string;
  statusUrl: string;
  active: boolean;
  expired: boolean;
  consumed: boolean;
  expiresAt: string;
  items: MobileUploadItem[];
};

export type InitialData = {
  page: AppPage;
  session: AppSession;
  payload: Record<string, unknown>;
};

export type FormErrors = Record<string, string[]>;
