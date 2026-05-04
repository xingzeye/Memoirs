import { useState } from "react";
import { apiJson } from "./lib/api";
import type { AppSession, InitialData } from "./lib/types";
import { ArchiveScreen } from "./components/ArchiveScreen";
import { AuthScreen } from "./components/AuthScreen";
import { MemoirEditorScreen } from "./components/MemoirEditorScreen";
import { MobileUploadScreen } from "./components/MobileUploadScreen";

type AppProps = {
  initialData: InitialData;
};

export function App({ initialData }: AppProps) {
  const [session] = useState<AppSession>(initialData.session);

  async function logout() {
    if (!session.routes.logout) return;
    const response = await apiJson<{ redirect: string }>(session.routes.logout, session.csrfToken, {});
    window.location.assign(response.redirect);
  }

  if (initialData.page === "auth") {
    return <AuthScreen session={session} payload={initialData.payload} />;
  }

  if (initialData.page === "editor") {
    return <MemoirEditorScreen session={session} payload={initialData.payload} onLogout={logout} />;
  }

  if (initialData.page === "mobile-upload") {
    return <MobileUploadScreen session={session} payload={initialData.payload} />;
  }

  return <ArchiveScreen session={session} payload={initialData.payload} onLogout={logout} />;
}
