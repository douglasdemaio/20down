import { Route, Routes } from "react-router-dom";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SocketNotice } from "@/components/socket-notice";
import { ScrollToTop } from "@/components/scroll-to-top";
import { LobbyPage } from "@/pages/lobby-page";
import { TablePage } from "@/pages/table-page";
import { RulesIndexPage, RulesPage } from "@/pages/rules-page";
import { VerifyPage } from "@/pages/verify-page";
import { SettingsPage } from "@/pages/settings-page";
import { NotFoundPage } from "@/pages/not-found-page";

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <SiteHeader />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/table/:tableId" element={<TablePage />} />
          <Route path="/rules" element={<RulesIndexPage />} />
          <Route path="/rules/:slug" element={<RulesPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <SiteFooter />
      <SocketNotice />
    </div>
  );
}
