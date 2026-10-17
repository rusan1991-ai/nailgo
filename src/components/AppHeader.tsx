import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AppHeader() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const links = [
    { to: "/", label: "Поиск мастеров" },
    { to: "/pro", label: "Для мастеров" },
    { to: "/journal", label: "Журнал" },
  ];

  const onAuthClick = () => {
    if (user) {
      signOut();
      navigate("/");
      return;
    }
    navigate("/login");
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f9e7ef] pb-6">
      <Link to="/" className="flex items-center gap-2 text-3xl font-semibold">
        <span className="text-[#ec4899]">Nail</span>
        <span>2 Go</span>
      </Link>

      <nav className="hidden items-center gap-8 text-sm text-slate-600 lg:flex">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? "font-medium text-slate-900" : "hover:text-slate-900"
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {user && <span className="hidden text-sm text-slate-500 md:inline">{user.name}</span>}
        {user && (
          <button
            onClick={() => navigate("/account")}
            className="rounded-xl border border-[#f2dfe7] px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            Профиль
          </button>
        )}
        <button
          onClick={onAuthClick}
          className="rounded-xl border border-[#f0cddd] px-5 py-2 text-sm font-medium text-[#c95685] transition hover:bg-[#fff4f8]"
        >
          {user ? "Выйти" : "Войти"}
        </button>
      </div>
    </header>
  );
}