import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../utils/cn";

const navItems = [{ to: "/admin/reviews", label: "Отзывы" }];

/**
 * Каркас админки: пока один раздел — модерация отзывов.
 * Остальные разделы (мастера, контент, файлы) появятся вместе с пунктом 10 карты.
 */
export function AdminLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f8f7fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-6">
            <Link to="/admin/reviews" className="text-sm font-semibold uppercase tracking-[0.2em] text-pink-500">
              NailGo · админка
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "rounded-lg px-3 py-1.5 text-sm transition",
                      isActive ? "bg-pink-500 text-white" : "text-slate-600 hover:bg-slate-100",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user?.name ?? "Администратор"}</span>
            <Link to="/" className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              На сайт
            </Link>
            <button
              type="button"
              onClick={() => {
                signOut();
                navigate("/admin/login", { replace: true });
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
