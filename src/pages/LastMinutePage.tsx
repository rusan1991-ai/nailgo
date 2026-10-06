import { Link } from "react-router-dom";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub, lastMinuteOffers } from "../data/mock";

function discountPercent(regular: number, special: number) {
  if (regular <= 0) return 0;
  return Math.round((1 - special / regular) * 100);
}

export function LastMinutePage() {
  return (
    <ClientShell title="Горящие окна">
      <div className="mb-4 flex flex-wrap gap-2">
        {["Сегодня", "Завтра", "Рядом", "До 2000 ₽"].map((chip) => (
          <button key={chip} className="rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 hover:border-pink-300">
            {chip}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lastMinuteOffers.map((offer) => (
          <article key={offer.id} className="rounded-2xl border border-[#f1dde6] p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="rounded-lg bg-pink-50 px-2 py-1 text-pink-600">{offer.dateLabel}</span>
              <span className="font-medium">{offer.time}</span>
            </div>

            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <Link to={`/master/${offer.masterSlug}`} className="truncate font-semibold hover:text-pink-600">
                  {offer.masterName}
                </Link>
                <p className="text-sm text-slate-500">★ {offer.rating}</p>
                <p className="text-sm text-slate-500">
                  {offer.metro} · {offer.distance}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-[#f1dde6] p-3">
              <p className="font-medium">{offer.service}</p>
              <p className="text-sm text-slate-500">{offer.duration}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-slate-400 line-through">{formatRub(offer.regularPrice)}</span>
                <span className="font-semibold text-pink-600">{formatRub(offer.specialPrice)}</span>
                <span className="rounded-md bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-600">
                  -{discountPercent(offer.regularPrice, offer.specialPrice)}%
                </span>
              </div>
            </div>

            <Link
              to={`/booking?master=${offer.masterSlug}&service=s2&date=${encodeURIComponent(offer.dateLabel)}&slot=${encodeURIComponent(offer.time)}`}
              className="mt-3 block rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white hover:bg-pink-600"
            >
              Записаться
            </Link>
          </article>
        ))}
      </div>
    </ClientShell>
  );
}