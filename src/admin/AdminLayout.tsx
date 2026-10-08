import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../utils/cn";

const navItems = [
  { to: "/admin", label: "Обзор", end: true },
  { to: "/admin/masters", label: "Мастера" },
  { to: "/admin/reviews", label: "Отзывы" },
  { to: "/admin/limits", label: "Лимиты" },
  { to: "/admin/deliveries", label: "Доставка" },
  { to: "/admin/payments", label: "Платежи" },
];

/**
 * Каркас админки: обзор, мастера, модерация отзывов, лимиты входа, доставка и
 * предоплаты. Все разделы ходят под ролью admin.
 */
export function AdminLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f8f7fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-6">
            <Link to="/admin" className="text-sm font-semibold uppercase tracking-[0.2em] text-pink-500">
              Nail 2 Go · админка
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
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
