/**
 * Аватар мастера: настоящее фото, если оно загружено, иначе фирменный градиент.
 * Плейсхолдер остаётся, чтобы карточка каталога не «прыгала» до загрузки фото.
 */
export function Avatar({
  className = "",
  src = null,
  name,
  size = 48,
}: {
  className?: string;
  /** Ссылка на уменьшенный вариант фото (thumbUrl). */
  src?: string | null;
  name?: string;
  /** Фиксированные пиксельные размеры не зависят от aspect-ratio и flex-gap. */
  size?: number;
}) {
  const dimensions = { width: size, height: size, minWidth: size, minHeight: size, flexShrink: 0 };

  if (src) {
    return (
      <img
        src={src}
        alt={name ? `Фото мастера ${name}` : "Фото мастера"}
        loading="lazy"
        className={`inline-block shrink-0 rounded-full object-cover ${className}`}
        style={dimensions}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_20%,#f7d5c8_20%,#a46e58_70%,#4f352b)] text-sm font-semibold text-white ${className}`}
      style={dimensions}
    >
      {name ? name.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

export function NailStrip() {
  return (
    <div className="flex space-x-2">
      {["#d7b1a1", "#b78476", "#4f6da8", "#d26388"].map((color) => (
        <div key={color} className="h-12 w-12 shrink-0 rounded-lg sm:h-14 sm:w-14" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}