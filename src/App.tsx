import type { ReactNode } from "react";
import { Link, BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, isMaster, useAuth } from "./auth/AuthContext";
import { CityProvider } from "./city/CityContext";
import { AdminLayout } from "./admin/AdminLayout";
import { AdminDashboardPage } from "./admin/pages/AdminDashboardPage";
import { AdminLimitsPage } from "./admin/pages/AdminLimitsPage";
import { AdminMastersPage } from "./admin/pages/AdminMastersPage";
import { AdminReviewsPage } from "./admin/pages/AdminReviewsPage";
import { AdminDeliveriesPage } from "./admin/pages/AdminDeliveriesPage";
import { AdminPaymentsPage } from "./admin/pages/AdminPaymentsPage";
import { BookingProvider } from "./bookings/BookingContext";
import { BookingPage } from "./pages/BookingPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { HomePage } from "./pages/HomePage";
import { JournalPage } from "./pages/JournalPage";
import { LastMinutePage } from "./pages/LastMinutePage";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { PayPage } from "./pages/PayPage";
import { MasterPage } from "./pages/MasterPage";
import { MessagesClientPage } from "./pages/MessagesClientPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SearchMapPage } from "./pages/SearchMapPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ShortLinkPage } from "./pages/ShortLinkPage";
import { AccountPage } from "./pages/AccountPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { MasterLayout } from "./master/MasterLayout";
import { DashboardPage } from "./master/pages/DashboardPage";
import { SchedulePage } from "./master/pages/SchedulePage";
import { BookingsPage } from "./master/pages/BookingsPage";
import { ClientsPage } from "./master/pages/ClientsPage";
import { ServicesPage } from "./master/pages/ServicesPage";
import { ReviewsProPage } from "./master/pages/ReviewsProPage";
import { StatsPage } from "./master/pages/StatsPage";
import { MessagesPage } from "./master/pages/MessagesPage";
import { SettingsProPage } from "./master/pages/SettingsProPage";
import { MediaPage } from "./master/pages/MediaPage";

function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7fa] px-6 text-center">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
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

function RequireAuth({
  children,
  masterOnly = false,
  adminOnly = false,
}: {
  children: ReactNode;
  masterOnly?: boolean;
  adminOnly?: boolean;
}) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    // Админские разделы ведут на свою форму входа, остальное — на общий вход.
    const target = adminOnly ? "/admin/login" : "/login";
    return <Navigate to={`${target}?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (adminOnly && user.role !== "admin") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff7fa] px-6 text-center text-slate-600">
        <div className="max-w-md">
          <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Раздел доступен администратору</h1>
          <p className="mt-2 text-sm">
            Вы вошли как {user.role === "master" ? "мастер" : "клиент"} ({user.phone ?? "без телефона"}). Модерация отзывов — на
            администраторе.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={signOut}
              className="rounded-xl border border-pink-200 px-5 py-3 text-sm font-medium text-pink-600 transition hover:bg-pink-50"
            >
              Выйти и войти как администратор
            </button>
            <Link to="/" className="rounded-xl bg-pink-500 px-5 py-3 text-sm font-semibold text-white hover:bg-pink-600">
              На главную
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (masterOnly && !isMaster(user)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff7fa] px-6 text-center text-slate-600">
        <div className="max-w-md">
          <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Кабинет доступен мастерам</h1>
          <p className="mt-2 text-sm">
            Вы вошли как клиент ({user.phone ?? "без телефона"}). Чтобы открыть кабинет, войдите как мастер.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={signOut}
              className="rounded-xl border border-pink-200 px-5 py-3 text-sm font-medium text-pink-600 transition hover:bg-pink-50"
            >
              Выйти и войти как мастер
            </button>
            <Link to="/" className="rounded-xl bg-pink-500 px-5 py-3 text-sm font-semibold text-white hover:bg-pink-600">
              На главную
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <CityProvider>
        <BookingProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchMapPage />} />
            <Route path="/last-minute" element={<Navigate to="/last-minute/moskva" replace />} />
            <Route path="/last-minute/:city" element={<LastMinutePage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* Сюда возвращает провайдер входа (Яндекс ID, VK ID). */}
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* Отдельный вход администратора: на сайте на него нет ссылок. */}
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/master/:slug" element={<MasterPage />} />
            {/*
              Короткие ссылки мастера: `/masters/any_nails` и «как в ВК» —
              корневая `/any_nails`. Статические маршруты выше по приоритету,
              поэтому разделы сайта они не перекрывают.
            */}
            <Route path="/masters/:username" element={<ShortLinkPage />} />
            <Route
              path="/booking"
              element={
                <RequireAuth>
                  <BookingPage />
                </RequireAuth>
              }
            />
            {/* Кабинет мастера доступен только владельцу кабинета (роль master). */}
            <Route
              path="/pro"
              element={
                <RequireAuth masterOnly>
                  <MasterLayout />
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              {/* `/pro/dashboard` — тот же обзор: адрес из документации этапа. */}
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="reviews" element={<ReviewsProPage />} />
              <Route path="promotion" element={<Navigate to="/pro" replace />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="media" element={<MediaPage />} />
              <Route path="settings" element={<SettingsProPage />} />
            </Route>
            <Route
              path="/favorites"
              element={
                <RequireAuth>
                  <FavoritesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/messages"
              element={
                <RequireAuth>
                  <MessagesClientPage />
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
              path="/pay/:id"
              element={
                <RequireAuth>
                  <PayPage />
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
            {/* Кабинет клиента доступен и по адресу /cabinet — тем же экраном. */}
            <Route
              path="/cabinet"
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
            <Route
              path="/admin"
              element={
                <RequireAuth adminOnly>
                  <AdminLayout />
                </RequireAuth>
              }
            >
              <Route index element={<AdminDashboardPage />} />
              <Route path="masters" element={<AdminMastersPage />} />
              <Route path="reviews" element={<AdminReviewsPage />} />
              <Route path="limits" element={<AdminLimitsPage />} />
              <Route path="deliveries" element={<AdminDeliveriesPage />} />
              <Route path="payments" element={<AdminPaymentsPage />} />
            </Route>
            <Route path="/home" element={<Navigate to="/" replace />} />
            {/* Короткая ссылка мастера в корне: /any_nails */}
            <Route path="/:username" element={<ShortLinkPage />} />
            <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </BookingProvider>
      </CityProvider>
    </AuthProvider>
  );
}