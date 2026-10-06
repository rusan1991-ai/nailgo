import { Link } from "react-router-dom";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { masters } from "../data/mock";

export function FavoritesPage() {
  return (
    <ClientShell title="Избранное">
      <div className="space-y-3">
        {masters.slice(0, 3).map((master) => (
          <article key={master.slug} className="rounded-2xl border border-[#f1dde6] p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <Link to={`/master/${master.slug}`} className="truncate font-semibold hover:text-pink-600">
                  {master.name}
                </Link>
                <p className="truncate text-sm text-slate-500">{master.tags}</p>
                <p className="text-sm text-slate-500">{master.metro}, {master.distance}</p>
              </div>
              <button className="text-xl text-pink-500">♥</button>
            </div>
          </article>
        ))}
      </div>
    </ClientShell>
  );
}