/**
 * Сердечко «в избранное» на карточке мастера.
 *
 * Гость по нажатию уходит на форму входа: без сессии сервер не знает, чей это
 * список. Мастер и администратор тоже могут добавлять — телефон у них есть.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart } from "lucide-react";
import { useFavorites } from "../favorites/store";
import { cn } from "../utils/cn";

export function FavoriteButton({
  masterSlug,
  masterName,
  variant = "icon",
  className,
}: {
  masterSlug: string;
  masterName: string;
  variant?: "icon" | "wide";
  className?: string;
}) {
  const favorites = useFavorites();
  const navigate = useNavigate();
  const [hint, setHint] = useState<string | null>(null);

  const active = favorites.has(masterSlug);
  const pending = favorites.isPending(masterSlug);

  const onClick = async () => {
    const result = await favorites.toggle(masterSlug);
    if (result.needLogin) {
      navigate("/login", { state: { from: "/favorites" } });
      return;
    }
    if (!result.ok) {
      setHint("Не удалось сохранить — попробуйте ещё раз");
      window.setTimeout(() => setHint(null), 2500);
      return;
    }
    setHint(result.favorited ? "В избранном" : "Убрали из избранного");
    window.setTimeout(() => setHint(null), 2000);
  };

  const title = active ? `Убрать из избранного: ${masterName}` : `В избранное: ${masterName}`;

  if (variant === "wide") {
    return (
      <div className={cn("relative", className)}>
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          title={title}
          data-action="favorite-toggle"
          data-slug={masterSlug}
          data-active={active ? "true" : "false"}
          aria-pressed={active}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition",
            active
              ? "border-pink-200 bg-pink-50 text-[#e11d48]"
              : "border-[#f1dde6] text-slate-600 hover:border-pink-300 hover:text-[#e11d48]",
          )}
        >
          <Heart className={cn("h-4 w-4", active && "fill-current")} />
          {active ? "В избранном" : "В избранное"}
        </button>
        {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={title}
        aria-label={title}
        data-action="favorite-toggle"
        data-slug={masterSlug}
        data-active={active ? "true" : "false"}
        aria-pressed={active}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-xl border transition",
          active
            ? "border-pink-200 bg-pink-50 text-[#e11d48]"
            : "border-[#f1dde6] text-slate-400 hover:border-pink-300 hover:text-[#e11d48]",
        )}
      >
        <Heart className={cn("h-4 w-4", active && "fill-current")} />
      </button>
      {hint && (
        <span className="absolute right-0 top-10 z-10 whitespace-nowrap rounded-lg bg-slate-900/90 px-2 py-1 text-xs text-white">
          {hint}
        </span>
      )}
    </div>
  );
}
