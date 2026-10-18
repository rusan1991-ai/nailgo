import { useState, type FormEvent } from "react";
import { ArrowRight, Flower2, Mail, MapPin, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useCity } from "../city/CityContext";

type FooterLink = { label: string; to?: string };
type FooterColumn = { title: string; links: FooterLink[] };

const footerColumns: FooterColumn[] = [
  {
    title: "Клиентам",
    links: [
      { label: "Как это работает", to: "/#how-it-works" },
      { label: "Поиск мастеров", to: "/search" },
      { label: "Отзывы", to: "/reviews" },
      { label: "Подарочные сертификаты" },
      { label: "Вопросы и ответы" },
      { label: "Правила сервиса" },
    ],
  },
  {
    title: "Мастерам",
    links: [
      { label: "Стать мастером", to: "/pro" },
      { label: "Управление профилем", to: "/pro" },
      { label: "Календарь записей", to: "/pro/schedule" },
      { label: "Продвижение профиля", to: "/pro/promotion" },
      { label: "Помощь мастерам", to: "/journal" },
      { label: "Блог для мастеров", to: "/journal" },
    ],
  },
  {
    title: "О компании",
    links: [
      { label: "О нас", to: "/#site-footer-about" },
      { label: "Контакты", to: "/#footer-contact" },
      { label: "Вакансии" },
      { label: "Партнёрам" },
      { label: "Пресс-центр" },
      { label: "Пользовательское соглашение" },
    ],
  },
];

function FooterItem({ link }: { link: FooterLink }) {
  if (link.to) {
    return (
      <Link to={link.to} className="block py-1 text-sm leading-relaxed text-[#746b68] transition hover:text-[#c8756b]">
        {link.label}
      </Link>
    );
  }
  return <span className="block py-1 text-sm leading-relaxed text-[#9b918e]">{link.label}</span>;
}

export function MarketplaceFooter({
  compactSearch = false,
  homeAccent = false,
}: {
  compactSearch?: boolean;
  homeAccent?: boolean;
}) {
  const { region } = useCity();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");

  const submitNewsletter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The repository has no newsletter endpoint or consent store yet. Do not
    // claim the address was saved until a real subscription service is wired.
    setNotice("Приём подписок скоро откроется. Адрес пока не сохранён.");
  };

  return (
    <footer
      className={`n2g-site-footer w-full bg-white px-4 pb-5 pt-8 text-[#2f2928] sm:px-6 sm:pt-10 ${homeAccent ? "n2g-home-footer" : ""} ${compactSearch ? "n2g-search-footer" : ""}`}
      data-block="site-footer"
    >
      <div className="mx-auto max-w-[1440px]">
        <section
          id="newsletter"
          className="relative overflow-hidden rounded-[26px] border border-[#f0ded9] bg-[#fff8f6] px-5 py-6 sm:px-8 sm:py-8 xl:px-11"
          aria-labelledby="newsletter-title"
          data-block="newsletter"
        >
          <div className="pointer-events-none absolute -right-6 -top-10 h-48 w-48 rounded-full border border-[#f3e1dd]" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-2 -top-6 h-36 w-36 rounded-full border border-[#f4e4e0]" aria-hidden="true" />
          <div className="grid min-w-0 items-center xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
            <div className="mb-5 flex min-w-0 items-center sm:mb-0">
              <span className="mr-5 grid h-24 w-24 min-h-[96px] min-w-[96px] shrink-0 place-items-center rounded-full border border-[#edd5d0] bg-white text-[#e58e82] sm:mr-7">
                <Mail className="h-12 w-12" strokeWidth={1.2} aria-hidden="true" />
              </span>
              <div className="min-w-0 max-w-xl">
                <h2 id="newsletter-title" className="text-xl font-medium leading-snug text-[#302a29] sm:text-2xl">
                  Будьте в курсе новинок
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#817774] sm:text-base">
                  Подпишитесь на нашу рассылку и получайте полезные советы и специальные предложения
                </p>
              </div>
            </div>
            <form onSubmit={submitNewsletter} className="grid min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="relative mb-3 block min-w-0 sm:mb-0 sm:mr-3">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a69a96]" aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  aria-label="Ваш e-mail"
                  placeholder="Ваш e-mail"
                  className="h-12 w-full min-w-0 rounded-xl border border-[#eadbd7] bg-white px-11 text-base text-[#463c39] outline-none placeholder:text-[#aaa09d] focus:border-[#e58e82]"
                  data-field="newsletter-email"
                />
              </label>
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-[#e58e82] px-6 text-sm font-semibold text-white transition hover:bg-[#d77d72] sm:px-7"
                data-action="newsletter-submit"
              >
                Подписаться
              </button>
              {notice && <p className="mt-2 text-xs text-[#8a6d67] sm:col-span-2" role="status">{notice}</p>}
            </form>
          </div>
        </section>

        <div className="my-8 border-t border-[#eee4e1] sm:my-10" />

        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          <div id="site-footer-about" className="mb-8 min-w-0 pr-6 lg:mb-0 lg:pr-8">
            <Link to="/" className="inline-flex items-center text-[27px] font-medium tracking-wide text-[#c8766d]">
              <Flower2 className="mr-3 h-12 w-12 shrink-0" strokeWidth={1.15} aria-hidden="true" />
              <span className="font-serif">nail2go</span>
            </Link>
            <p className="mt-4 max-w-[250px] text-sm leading-6 text-[#746b68]">
              Сервис поиска и записи к лучшим мастерам маникюра и педикюра в вашем городе.
            </p>
            <Link to="/search" className="mt-5 inline-flex items-center text-sm font-medium text-[#c8756b] hover:text-[#a85f57]">
              Найти мастера <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {footerColumns.map((column) => (
            <nav key={column.title} className="mb-8 min-w-0 pr-5 lg:mb-0" aria-label={column.title}>
              <h2 className="mb-4 text-base font-medium text-[#302a29]">{column.title}</h2>
              {column.links.map((link) => <FooterItem key={link.label} link={link} />)}
            </nav>
          ))}

          <div id="footer-contact" className="mb-8 min-w-0 lg:mb-0">
            <h2 className="mb-4 text-base font-medium text-[#302a29]">Контакты</h2>
            <div className="mb-4 flex items-start text-sm leading-relaxed text-[#746b68]">
              <MapPin className="mr-3 mt-0.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
              <span>Выбранный регион: {region}</span>
            </div>
            <div className="mb-4 flex items-start text-sm leading-relaxed text-[#746b68]">
              <Search className="mr-3 mt-0.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
              <span>Адреса и контакты указаны в профилях мастеров</span>
            </div>
            <Link to="/search" className="inline-flex items-center text-sm font-medium text-[#c8756b] hover:text-[#a85f57]">
              Открыть каталог <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between border-t border-[#eee4e1] pt-5">
          <p className="mr-4 mb-2 text-sm text-[#8a807d] sm:mb-0">© {new Date().getFullYear()} nail2go. Все права защищены.</p>
          <Link to="/journal" className="mb-2 text-sm text-[#8a807d] hover:text-[#c8756b] sm:mb-0">Журнал NailGo</Link>
        </div>
      </div>
    </footer>
  );
}
