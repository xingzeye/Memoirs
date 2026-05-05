export type AppPage = "auth" | "archive" | "detail" | "editor" | "mobile-upload";

export type AppRoutes = {
  session?: string;
  login?: string;
  register?: string;
  logout?: string;
  memoirs?: string;
  mobileUploadSessions?: string;
  memoirList?: string;
  memoirCreate?: string;
  loginPage?: string;
  registerPage?: string;
};

export type AppSession = {
  user: { id: number; username: string; isStaff: boolean } | null;
  allowPublicRegistration: boolean;
  csrfToken: string;
  routes: AppRoutes;
};

export type MediaItem = {
  id: number;
  url: string;
  absoluteUrl: string;
  type: "image" | "video";
  name: string;
  mimeType: string;
  size: number;
  uploadedAt?: string;
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
  mediaCount: number;
  media: MediaItem[];
  urls: {
    detail: string;
    edit: string;
    delete: string;
    api: string;
    apiDelete: string;
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
