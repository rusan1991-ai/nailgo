/**
 * Аватар мастера: настоящее фото, если оно загружено, иначе фирменный градиент.
 * Плейсхолдер остаётся, чтобы карточка каталога не «прыгала» до загрузки фото.
 */
export function Avatar({
  className = "",
  src = null,
  name,
}: {
  className?: string;
  /** Ссылка на уменьшенный вариант фото (thumbUrl). */
  src?: string | null;
  name?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ? `Фото мастера ${name}` : "Фото мастера"}
        loading="lazy"
        className={`rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`grid place-items-center rounded-full bg-[radial-gradient(circle_at_30%_20%,#f7d5c8_20%,#a46e58_70%,#4f352b)] text-sm font-semibold text-white ${className}`}
    >
      {name ? name.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

export function NailStrip() {
  return (
    <div className="flex gap-2">
      {["#d7b1a1", "#b78476", "#4f6da8", "#d26388"].map((color) => (
        <div key={color} className="h-14 w-14 rounded-lg" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}