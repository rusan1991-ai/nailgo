import { useEffect, type ChangeEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "../../utils/cn";

/* ------------------------------------------------------------------ */
/* Карточки и заголовки                                                */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  tabs,
}: {
  title: string;
  /** Подпись под заголовком: чем эта страница полезна. */
  subtitle?: string;
  action?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  className,
  disabled,
  title,
  dataAction,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  title?: string;
  /** Стабильный селектор для проверок: `data-action` на кнопке. */
  dataAction?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-action={dataAction}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl bg-[#e11d48] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#be123c] active:scale-[0.99]",
        disabled && "cursor-not-allowed opacity-60 hover:bg-[#e11d48]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className,
  active,
  dataAction,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  active?: boolean;
  /** Стабильный селектор для проверок: `data-action` на кнопке. */
  dataAction?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-action={dataAction}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition",
        active
          ? "border-[#e11d48] bg-rose-50 text-[#e11d48]"
          : "border-slate-200 text-slate-600 hover:bg-slate-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Чипы, аватары                                                       */
/* ------------------------------------------------------------------ */

export type ChipTone = "green" | "amber" | "red" | "blue" | "purple" | "gray";

const chipTones: Record<ChipTone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-rose-50 text-rose-500",
  blue: "bg-sky-50 text-sky-600",
  purple: "bg-violet-50 text-violet-600",
  gray: "bg-slate-100 text-slate-500",
};

export function Chip({ tone = "gray", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium", chipTones[tone])}>
      {children}
    </span>
  );
}

const avatarPalette = [
  "from-fuchsia-200 to-pink-400",
  "from-sky-200 to-indigo-400",
  "from-emerald-200 to-teal-400",
  "from-amber-200 to-orange-400",
  "from-violet-200 to-purple-400",
];

export function PersonAvatar({
  name,
  size = 36,
  src = null,
}: {
  name: string;
  size?: number;
  /** Фото мастера (thumb из master_media): админка показывает его вместо инициалов. */
  src?: string | null;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={`Фото мастера ${name}`}
        loading="lazy"
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const index = Math.abs(name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % avatarPalette.length;

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-semibold text-white/95",
        avatarPalette[index],
      )}
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Поля ввода и фильтры                                                */
/* ------------------------------------------------------------------ */

export function SearchInput({
  placeholder,
  value,
  onChange,
  className,
}: {
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
      <input
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-rose-300"
      />
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
  placeholderPrefix,
  avatarName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholderPrefix?: ReactNode;
  avatarName?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {avatarName && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          <PersonAvatar name={avatarName} size={24} />
        </span>
      )}
      {placeholderPrefix && !avatarName && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {placeholderPrefix}
        </span>
      )}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pr-9 text-sm text-slate-700 outline-none transition focus:border-rose-300",
          avatarName ? "pl-10" : placeholderPrefix ? "pl-9" : "pl-3",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-rose-300"
      />
      {hint && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-rose-300"
      />
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition",
        checked ? "bg-[#2f6fed]" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <p className="text-sm text-slate-700">{label}</p>
        {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      </div>
      {control}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600">
      <span
        onClick={() => onChange(!checked)}
        className={cn(
          "grid h-4.5 w-4.5 place-items-center rounded-[5px] border transition",
          checked ? "border-[#e11d48] bg-[#e11d48]" : "border-slate-300 bg-white",
        )}
        style={{ width: 18, height: 18 }}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6.5 4.5 9 10 3.5" />
          </svg>
        )}
      </span>
      <span onClick={() => onChange(!checked)}>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Табы и пагинация                                                    */
/* ------------------------------------------------------------------ */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-6 border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px flex items-center gap-2 pb-3 text-sm transition",
              isActive ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs",
                  isActive ? "bg-rose-50 text-[#e11d48]" : "bg-slate-100 text-slate-500",
                )}
              >
                {tab.count}
              </span>
            )}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#e11d48]" />}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-[10px] px-3.5 py-1.5 text-sm transition",
            option === value ? "bg-[#e11d48] font-medium text-white" : "text-slate-500 hover:text-slate-700",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  total,
  page,
  onPage,
  label,
}: {
  total: number;
  page: number;
  onPage: (page: number) => void;
  label: string;
}) {
  const pages = Array.from({ length: total }, (_, index) => index + 1);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <p>{label}</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPage(item)}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg text-sm transition",
              item === page ? "bg-rose-50 font-medium text-[#e11d48]" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPage(Math.min(total, page + 1))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16 backdrop-blur-[2px]">
      <div className={cn("w-full rounded-2xl bg-white shadow-xl", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Stars({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, index) => (
        <svg
          key={index}
          viewBox="0 0 20 20"
          className={cn("h-4 w-4", index < score ? "text-amber-400" : "text-slate-200")}
          fill="currentColor"
        >
          <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" />
        </svg>
      ))}
    </span>
  );
}
