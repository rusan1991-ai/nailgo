import { cn } from "../../utils/cn";

/* ------------------------------------------------------------------ */
/* Спарклайн для KPI-карточек                                          */
/* ------------------------------------------------------------------ */

export function Sparkline({
  points,
  color = "#e11d48",
  className,
}: {
  points: number[];
  color?: string;
  className?: string;
}) {
  const width = 120;
  const height = 36;
  if (points.length === 0) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / Math.max(1, points.length - 1);

  const coords = points.map((value, index) => ({
    x: index * step,
    y: height - ((value - min) / span) * (height - 6) - 3,
  }));

  const path = coords
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const prev = coords[index - 1];
      const cx = (prev.x + point.x) / 2;
      return `C ${cx} ${prev.y} ${cx} ${point.y} ${point.x} ${point.y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-9 w-[120px]", className)} fill="none">
      <path d={path} stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Линейный график с областью                                          */
/* ------------------------------------------------------------------ */

export function AreaLineChart({
  points,
  labels,
  color = "#e11d48",
  height = 240,
  unit = "",
  showYAxis = true,
}: {
  points: number[];
  labels: string[];
  color?: string;
  height?: number;
  unit?: string;
  showYAxis?: boolean;
}) {
  const width = 720;
  const padding = { top: 16, right: 8, bottom: 28, left: showYAxis ? 34 : 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (points.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400"
        style={{ height }}
      >
        Нет данных за период
      </div>
    );
  }

  const max = Math.max(...points) * 1.15 || 1;
  const step = plotWidth / Math.max(1, points.length - 1);
  const coords = points.map((value, index) => ({
    x: padding.left + index * step,
    y: padding.top + plotHeight - (value / max) * plotHeight,
  }));

  const line = coords
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const prev = coords[index - 1];
      const cx = (prev.x + point.x) / 2;
      return `C ${cx} ${prev.y} ${cx} ${point.y} ${point.x} ${point.y}`;
    })
    .join(" ");

  const area = `${line} L ${coords[coords.length - 1].x} ${padding.top + plotHeight} L ${coords[0].x} ${
    padding.top + plotHeight
  } Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1];
  const gradientId = `grad-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridValues.map((ratio) => {
        const y = padding.top + plotHeight * ratio;
        return (
          <g key={ratio}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="4 6"
              vectorEffect="non-scaling-stroke"
            />
            {showYAxis && (
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                {Math.round(max * (1 - ratio))}
                {unit}
              </text>
            )}
          </g>
        );
      })}

      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} stroke={color} strokeWidth="2.5" fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" />

      {labels.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={padding.left + index * step}
          y={height - 8}
          textAnchor="middle"
          fontSize="11"
          fill="#94a3b8"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Несколько линий (динамика показателей)                              */
/* ------------------------------------------------------------------ */

export function MultiLineChart({
  series,
  labels,
  height = 240,
}: {
  series: { key: string; color: string; points: number[] }[];
  labels: string[];
  height?: number;
}) {
  const width = 720;
  const padding = { top: 16, right: 8, bottom: 28, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = 100;
  const step = plotWidth / Math.max(1, labels.length - 1);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + plotHeight * ratio;
          return (
            <g key={`grid-${ratio}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                {Math.round(max * (1 - ratio))}%
              </text>
            </g>
          );
        })}

        {series.map((line) => {
          const path = line.points
            .map((value, index) => {
              const x = padding.left + index * step;
              const y = padding.top + plotHeight - (value / max) * plotHeight;
              return `${index === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          return (
            <path
              key={line.key}
              d={path}
              stroke={line.color}
              strokeWidth="2"
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          );
        })}

        {labels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={padding.left + index * step}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#94a3b8"
          >
            {label}
          </text>
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.map((line) => (
          <span key={line.key} className="inline-flex items-center gap-2 text-xs text-slate-500">
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full border" style={{ borderColor: line.color }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: line.color }} />
            </span>
            {line.key}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Пончик (распределение)                                              */
/* ------------------------------------------------------------------ */

export function DonutChart({
  data,
  centerValue,
  centerLabel,
  size = 200,
}: {
  data: { label: string; percent: number; color: string; value?: number }[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="26" />
          {data.map((segment, index) => {
            const length = (segment.percent / 100) * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={`${segment.label}-${index}`}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth="26"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xl font-semibold text-slate-900">{centerValue}</p>
            <p className="text-xs text-slate-400">{centerLabel}</p>
          </div>
        </div>
      </div>

      <ul className="min-w-[210px] flex-1 space-y-3">
        {data.map((segment, index) => (
          <li key={`${segment.label}-${index}`} className="flex items-center justify-between gap-4 text-sm">
            <span className="inline-flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </span>
            <span className="whitespace-nowrap text-slate-500">
              {segment.percent}%{" "}
              {typeof segment.value === "number" ? (
                <span className="text-slate-400">({segment.value})</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Воронка конверсии                                                   */
/* ------------------------------------------------------------------ */

/**
 * Воронка по фактическим шагам: ширина полосы пропорциональна значению,
 * поэтому картинка честно показывает, где теряются записи.
 */
export function Funnel({ stages }: { stages: { label: string; value: number; percent: string | null }[] }) {
  const max = stages.reduce((peak, stage) => Math.max(peak, stage.value), 0);

  return (
    <div className="space-y-2.5">
      {stages.map((stage) => {
        const width = max > 0 ? Math.max((stage.value / max) * 100, 12) : 12;
        return (
          <div key={stage.label} className="relative">
            <div
              className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3"
              style={{ width: `${width}%` }}
            >
              <span className="truncate text-sm text-slate-600">{stage.label}</span>
              <span className="shrink-0 text-sm font-medium text-slate-900">
                {new Intl.NumberFormat("ru-RU").format(stage.value)}
              </span>
            </div>
            {stage.percent && (
              <span className="absolute inset-y-0 right-0 flex items-center pl-2 text-xs text-slate-400">
                {stage.percent}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Горизонтальный прогресс (заполненность профиля)                     */
/* ------------------------------------------------------------------ */

export function ProgressBar({ value, tone = "#22c55e" }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className="h-1.5 rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
    </div>
  );
}
