import { Archive, LogOut, Plus } from "lucide-react";
import type { AppSession } from "../lib/types";

type BrandProps = {
  session: AppSession;
  onLogout?: () => void;
};

export function Brand({ session, onLogout }: BrandProps) {
  return (
    <header className="app-topbar">
      <a className="brand-lockup" href={session.routes.memoirList || "/"}>
        <span className="brand-mark" aria-hidden="true">
          <Archive size={18} strokeWidth={1.8} />
        </span>
        <span>
          <strong>忆往昔</strong>
          <small>只属于你的旧时光</small>
        </span>
      </a>
      {session.user ? (
        <nav className="topbar-actions" aria-label="主导航">
          <a className="quiet-button" href={session.routes.memoirCreate || "/memoirs/new/"}>
            <Plus size={16} />
            新增回忆
          </a>
          <button className="quiet-button" type="button" onClick={onLogout}>
            <LogOut size={16} />
            退出
          </button>
        </nav>
      ) : null}
    </header>
  );
}

export function EmptyBrand() {
  return (
    <a className="auth-brand" href="/">
      <span className="brand-mark" aria-hidden="true">
        <Archive size={18} strokeWidth={1.8} />
      </span>
      <span>忆往昔</span>
    </a>
  );
}
