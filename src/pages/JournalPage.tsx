import { ClientShell } from "../components/ClientShell";
import { journalCards } from "../data/mock";

export function JournalPage() {
  return (
    <ClientShell title="Журнал">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {journalCards.map((card, idx) => (
          <article key={card.id} className="overflow-hidden rounded-2xl border border-[#f1dde6]">
            <div
              className="h-40"
              style={{
                background:
                  idx % 2
                    ? "linear-gradient(135deg,#f8c6d8,#f9e3ec)"
                    : "linear-gradient(135deg,#eec8bc,#f5e2d8)",
              }}
            />
            <div className="p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-pink-500">{card.tag}</p>
              <p className="mt-2 font-medium leading-snug">{card.title}</p>
            </div>
          </article>
        ))}
      </div>
    </ClientShell>
  );
}