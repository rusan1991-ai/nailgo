import { ArrowRight, Flower2, Heart, MapPin, Search, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { useCity } from "../city/CityContext";

type FooterLink = { label: string; to: string };
type FooterColumn = { title: string; links: FooterLink[] };

const footerColumns: FooterColumn[] = [
  {
    title: "Навигация",
    links: [
      { label: "Главная", to: "/" },
      { label: "Мастера", to: "/search" },
      { label: "Услуги", to: "/#home-popular-services" },
      { label: "Как это работает", to: "/#how-it-works" },
      { label: "Журнал", to: "/journal" },
    ],
  },
  {
    title: "Клиентам",
    links: [
      { label: "Избранное", to: "/favorites" },
      { label: "Личный кабинет", to: "/account" },
      { label: "Отзывы клиентов", to: "/#home-reviews" },
      { label: "Найти мастера", to: "/search" },
    ],
  },
  {
    title: "Мастерам",
    links: [
      { label: "Кабинет мастера", to: "/pro" },
      { label: "Войти в кабинет", to: "/pro/login" },
      { label: "Расписание", to: "/pro/schedule" },
      { label: "Услуги и цены", to: "/pro/services" },
      { label: "Продвижение", to: "/pro/promotion" },
    ],
  },
];

const socialLinks = [
  { label: "ВКонтакте", href: import.meta.env.VITE_PUBLIC_VK_URL, shortLabel: "VK" },
  { label: "Telegram", href: import.meta.env.VITE_PUBLIC_TELEGRAM_URL, shortLabel: "TG" },
].filter((social) => social.href?.startsWith("https://"));

function FooterItem({ link }: { link: FooterLink }) {
  return (
    <Link
      to={link.to}
      className="block py-1 text-sm leading-relaxed text-[#746b68] transition hover:text-[#D77D72]"
    >
      {link.label}
    </Link>
  );
}

export function MarketplaceFooter({
  compactSearch = false,
  homeAccent = false,
}: {
  compactSearch?: boolean;
  homeAccent?: boolean;
}) {
  const { region } = useCity();

  return (
    <footer
      className={`n2g-site-footer w-full bg-white px-4 pb-5 pt-8 text-[#2f2928] sm:px-6 sm:pt-10 ${homeAccent ? "n2g-home-footer" : ""} ${compactSearch ? "n2g-search-footer" : ""}`}
      data-block="site-footer"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="grid min-w-0 grid-cols-1 gap-y-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr_1.15fr] lg:gap-x-8" data-footer-grid>
          <div id="site-footer-about" className="min-w-0 pr-4">
            <Link to="/" className="inline-flex items-center text-[#D77D72]" aria-label="nail2go — главная">
              <Flower2 className="mr-2 h-10 w-10 shrink-0 text-[#E58E82]" strokeWidth={1.2} aria-hidden="true" />
              <span className="font-serif text-[25px] font-medium tracking-wide">nail2go</span>
            </Link>
            <p className="mt-4 max-w-[270px] text-sm leading-6 text-[#746b68]">
              Сервис поиска мастеров маникюра и педикюра и онлайн-записи в вашем городе.
            </p>
            <Link to="/search" className="mt-4 inline-flex items-center text-sm font-semibold text-[#C8776E] transition hover:text-[#D77D72]">
              Найти мастера <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
            {socialLinks.length > 0 && (
              <div className="mt-5 flex items-center space-x-2" data-footer-socials>
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={social.label}
                    className="grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full border border-[#E9DCD8] text-xs font-bold text-[#A96F66] transition hover:border-[#E58E82] hover:text-[#D77D72]"
                  >
                    {social.shortLabel === "TG" ? <Send className="h-4 w-4" aria-hidden="true" /> : social.shortLabel}
                  </a>
                ))}
              </div>
            )}
          </div>

          {footerColumns.map((column) => (
            <nav key={column.title} className="min-w-0" aria-label={column.title}>
              <h2 className="mb-3 text-sm font-semibold text-[#302a29]">{column.title}</h2>
              {column.links.map((link) => <FooterItem key={link.label} link={link} />)}
            </nav>
          ))}

          <div id="footer-contact" className="min-w-0">
            <h2 className="mb-3 text-sm font-semibold text-[#302a29]">Контакты</h2>
            <p className="mb-3 flex min-w-0 items-start text-sm leading-relaxed text-[#746b68]">
              <MapPin className="mr-2.5 mt-0.5 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
              <span>Выбранный регион: {region}</span>
            </p>
            <p className="mb-4 flex min-w-0 items-start text-sm leading-relaxed text-[#746b68]">
              <Search className="mr-2.5 mt-0.5 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
              <span>Адрес и способы связи доступны в профиле выбранного мастера.</span>
            </p>
            <Link to="/search" className="inline-flex items-center text-sm font-semibold text-[#C8776E] transition hover:text-[#D77D72]">
              Открыть каталог <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="mt-5 flex items-center space-x-2 text-xs text-[#827875]">
              <Heart className="h-4 w-4 text-[#E58E82]" aria-hidden="true" />
              <span>Выбор мастера — за вами</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between border-t border-[#EEE4E1] pt-5">
          <p className="mr-4 mb-2 text-sm text-[#8a807d] sm:mb-0">© {new Date().getFullYear()} nail2go. Все права защищены.</p>
          <div className="mb-2 flex items-center space-x-4 sm:mb-0">
            <Link to="/#home-popular-services" className="text-sm text-[#8a807d] transition hover:text-[#D77D72]">Услуги</Link>
            <Link to="/journal" className="text-sm text-[#8a807d] transition hover:text-[#D77D72]">Журнал nail2go</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
