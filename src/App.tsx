import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { BookingProvider } from "./bookings/BookingContext";
import { BookingPage } from "./pages/BookingPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { HomePage } from "./pages/HomePage";
import { JournalPage } from "./pages/JournalPage";
import { LastMinutePage } from "./pages/LastMinutePage";
import { LoginPage } from "./pages/LoginPage";
import { MasterPage } from "./pages/MasterPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProDashboardPage } from "./pages/ProDashboardPage";
import { SearchMapPage } from "./pages/SearchMapPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AccountPage } from "./pages/AccountPage";
import { ReviewsPage } from "./pages/ReviewsPage";

function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7fa] px-6 text-center">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-pink-500">NailGo</p>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">Страница не найдена</h1>
        <p className="mt-2 text-slate-500">Проверьте адрес или вернитесь на главную.</p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-xl bg-pink-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          На главную
        </a>
      </div>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BookingProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchMapPage />} />
            <Route path="/last-minute/:city" element={<LastMinutePage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/master/:slug" element={<MasterPage />} />
            <Route
              path="/booking"
              element={
                <RequireAuth>
                  <BookingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/pro"
              element={
                <RequireAuth>
                  <ProDashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/favorites"
              element={
                <RequireAuth>
                  <FavoritesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/notifications"
              element={
                <RequireAuth>
                  <NotificationsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/reviews"
              element={
                <RequireAuth>
                  <ReviewsPage />
                </RequireAuth>
              }
            />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </BookingProvider>
    </AuthProvider>
  );
}