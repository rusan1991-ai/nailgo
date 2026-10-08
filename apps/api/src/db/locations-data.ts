/**
 * Справочник мест: станции метро Санкт-Петербурга и города Ленинградской
 * области.
 *
 * Зачем он в базе, а не в коде витрины: по нему фильтруются мастера, он же
 * попадает в профиль мастера (`metroSlug`/`districtSlug`). Текстовый адрес
 * остаётся, но «удобно ли приехать» клиент выбирает именно здесь.
 *
 * Данные заводим одним списком: 5 линий метро с цветами линий и ключевые
 * города области, куда реально ездят за маникюром.
 */

export type LocationSeed = {
  slug: string;
  kind: "metro" | "district";
  name: string;
  region: string;
  line: string | null;
  color: string | null;
  lat: number | null;
  lng: number | null;
  sort: number;
};

const SPB = "Санкт-Петербург";
const LO = "Ленинградская область";

/** Цвета линий — как в схеме метро: по ним группируется фильтр. */
const LINES = {
  1: { title: "Кировско-Выборгская", color: "#e42313" },
  2: { title: "Московско-Петроградская", color: "#0d6fbf" },
  3: { title: "Невско-Василеостровская", color: "#12a04a" },
  4: { title: "Лахтинско-Правобережная", color: "#ef7f1a" },
  5: { title: "Фрунзенско-Приморская", color: "#8e3b9c" },
} as const;

const metro = (slug: string, name: string, line: keyof typeof LINES, lat: number, lng: number): LocationSeed => ({
  slug,
  kind: "metro",
  name,
  region: SPB,
  line: LINES[line].title,
  color: LINES[line].color,
  lat,
  lng,
  sort: line * 1000,
});

const district = (slug: string, name: string, region: string, lat: number, lng: number, sort: number): LocationSeed => ({
  slug,
  kind: "district",
  name,
  region,
  line: null,
  color: null,
  lat,
  lng,
  sort,
});

export const LOCATIONS_SEED: LocationSeed[] = [
  /* Линия 1 — красная */
  metro("devyatkino", "Девяткино", 1, 60.0503, 30.4431),
  metro("grazhdansky-prospekt", "Гражданский проспект", 1, 60.0349, 30.4184),
  metro("akademicheskaya", "Академическая", 1, 60.0126, 30.3958),
  metro("politekhnicheskaya", "Политехническая", 1, 60.0087, 30.3708),
  metro("ploshchad-muzhestva", "Площадь Мужества", 1, 59.9994, 30.3659),
  metro("lesnaya", "Лесная", 1, 59.9847, 30.3436),
  metro("vyborgskaya", "Выборгская", 1, 59.9704, 30.3481),
  metro("ploshchad-lenina", "Площадь Ленина", 1, 59.9556, 30.3554),
  metro("chernyshevskaya", "Чернышевская", 1, 59.9446, 30.3596),
  metro("ploshchad-vosstaniya", "Площадь Восстания", 1, 59.9317, 30.3606),
  metro("vladimirskaya", "Владимирская", 1, 59.9274, 30.3479),
  metro("pushkinskaya", "Пушкинская", 1, 59.9206, 30.3299),
  metro("tekhnologichesky-institut", "Технологический институт", 1, 59.9163, 30.3186),
  metro("baltiyskaya", "Балтийская", 1, 59.9073, 30.2995),
  metro("narvskaya", "Нарвская", 1, 59.9011, 30.2749),
  metro("kirovsky-zavod", "Кировский завод", 1, 59.8794, 30.2619),
  metro("avtovo", "Автово", 1, 59.8672, 30.2613),
  metro("leninsky-prospekt", "Ленинский проспект", 1, 59.8521, 30.2684),
  metro("prospekt-veteranov", "Проспект Ветеранов", 1, 59.8416, 30.2513),

  /* Линия 2 — синяя */
  metro("parnas", "Парнас", 2, 60.0671, 30.3337),
  metro("prospekt-prosveshcheniya", "Проспект Просвещения", 2, 60.0514, 30.3333),
  metro("ozerki", "Озерки", 2, 60.0372, 30.3215),
  metro("udelnaya", "Удельная", 2, 60.0166, 30.3158),
  metro("pionerskaya", "Пионерская", 2, 60.0023, 30.2967),
  metro("chernaya-rechka", "Чёрная речка", 2, 59.9857, 30.3008),
  metro("petrogradskaya", "Петроградская", 2, 59.9663, 30.3112),
  metro("gorkovskaya", "Горьковская", 2, 59.9559, 30.3187),
  metro("nevsky-prospekt", "Невский проспект", 2, 59.9358, 30.3272),
  metro("sennaya-ploshchad", "Сенная площадь", 2, 59.9267, 30.3203),
  metro("tekhnologichesky-institut-2", "Технологический институт (2)", 2, 59.9163, 30.3186),
  metro("frunzenskaya", "Фрунзенская", 2, 59.9061, 30.3168),
  metro("moskovskie-vorota", "Московские ворота", 2, 59.8916, 30.3182),
  metro("elektrosila", "Электросила", 2, 59.8793, 30.3186),
  metro("park-pobedy", "Парк Победы", 2, 59.8664, 30.3217),
  metro("moskovskaya", "Московская", 2, 59.8521, 30.3216),
  metro("zvyozdnaya", "Звёздная", 2, 59.8331, 30.3495),
  metro("kupchino", "Купчино", 2, 59.8294, 30.3755),

  /* Линия 3 — зелёная */
  metro("begovaya", "Беговая", 3, 59.9872, 30.2021),
  metro("zenit", "Зенит", 3, 59.9726, 30.2134),
  metro("primorskaya", "Приморская", 3, 59.9484, 30.2344),
  metro("vasileostrovskaya", "Василеостровская", 3, 59.9431, 30.2789),
  metro("gostiny-dvor", "Гостиный двор", 3, 59.9342, 30.3349),
  metro("mayakovskaya", "Маяковская", 3, 59.9315, 30.3546),
  metro("ploshchad-aleksandra-nevskogo", "Площадь Александра Невского", 3, 59.9237, 30.3856),
  metro("elizarovskaya", "Елизаровская", 3, 59.8974, 30.4232),
  metro("lomonosovskaya", "Ломоносовская", 3, 59.8775, 30.4405),
  metro("proletarskaya", "Пролетарская", 3, 59.8657, 30.4702),
  metro("obukhovo", "Обухово", 3, 59.8485, 30.4581),
  metro("rybatskoe", "Рыбацкое", 3, 59.8288, 30.5026),

  /* Линия 4 — оранжевая */
  metro("spasskaya", "Спасская", 4, 59.9267, 30.3203),
  metro("dostoevskaya", "Достоевская", 4, 59.9261, 30.3465),
  metro("ligovsky-prospekt", "Лиговский проспект", 4, 59.9204, 30.3554),
  metro("ploshchad-aleksandra-nevskogo-2", "Площадь Александра Невского (2)", 4, 59.9237, 30.3856),
  metro("novocherkasskaya", "Новочеркасская", 4, 59.9292, 30.4113),
  metro("ladozhskaya", "Ладожская", 4, 59.9325, 30.4393),
  metro("prospekt-bolshevikov", "Проспект Большевиков", 4, 59.9186, 30.4662),
  metro("ulitsa-dybenko", "Улица Дыбенко", 4, 59.9078, 30.4833),

  /* Линия 5 — фиолетовая */
  metro("komendantsky-prospekt", "Комендантский проспект", 5, 60.0086, 30.2586),
  metro("staraya-derevnya", "Старая Деревня", 5, 59.9892, 30.2551),
  metro("krestovsky-ostrov", "Крестовский остров", 5, 59.9711, 30.2596),
  metro("chkalovskaya", "Чкаловская", 5, 59.9606, 30.2900),
  metro("sportivnaya", "Спортивная", 5, 59.9511, 30.2878),
  metro("admiralteyskaya", "Адмиралтейская", 5, 59.9362, 30.3130),
  metro("sadovaya", "Садовая", 5, 59.9267, 30.3203),
  metro("zvenigorodskaya", "Звенигородская", 5, 59.9229, 30.3357),
  metro("obvodny-kanal", "Обводный канал", 5, 59.9133, 30.3496),
  metro("volkovskaya", "Волковская", 5, 59.8963, 30.3615),
  metro("bukharetskaya", "Бухарестская", 5, 59.8836, 30.3733),
  metro("mezhdunarodnaya", "Международная", 5, 59.8703, 30.3743),
  metro("prospekt-slavy", "Проспект Славы", 5, 59.8533, 30.3961),
  metro("dunayskaya", "Дунайская", 5, 59.8386, 30.4114),
  metro("shushary", "Шушары", 5, 59.8177, 30.4018),

  /* Ленинградская область: города и крупные районы, куда ездят мастера */
  district("vsevolozhsk", "Всеволожск", LO, 60.0205, 30.636, 100),
  district("murino", "Мурино", LO, 60.0473, 30.4441, 110),
  district("kudrovo", "Кудрово", LO, 59.9086, 30.5111, 120),
  district("gatchina", "Гатчина", LO, 59.5654, 30.1281, 130),
  district("sertolovo", "Сертолово", LO, 60.1418, 30.2033, 140),
  district("vsevolozhsk-berngardovka", "Бернгардовка", LO, 59.9972, 30.5872, 150),
  district("pushkin", "Пушкин", LO, 59.7196, 30.4137, 160),
  district("kolpino", "Колпино", LO, 59.7451, 30.5861, 170),
  district("krasnoe-selo", "Красное Село", LO, 59.7316, 30.0936, 180),
  district("lomonosov", "Ломоносов", LO, 59.9076, 29.7712, 190),
  district("peterhof", "Петергоф", LO, 59.8832, 29.9046, 200),
  district("vyborg", "Выборг", LO, 60.7097, 28.7529, 210),
  district("sosnovy-bor", "Сосновый Бор", LO, 59.8996, 29.0867, 220),
  district("tikhvin", "Тихвин", LO, 59.6442, 33.5424, 230),
  district("kirishi", "Кириши", LO, 59.4484, 32.0243, 240),
  district("tosno", "Тосно", LO, 59.5407, 30.8772, 250),
  district("priozersk", "Приозерск", LO, 61.0384, 30.1126, 260),
  district("volkhov", "Волхов", LO, 59.9255, 32.3386, 270),
];

/** Сколько чего в справочнике — пригодится админке и проверкам. */
export const LOCATIONS_COUNTS = {
  metro: LOCATIONS_SEED.filter((item) => item.kind === "metro").length,
  district: LOCATIONS_SEED.filter((item) => item.kind === "district").length,
};

export function locationBySlug(slug: string): LocationSeed | undefined {
  return LOCATIONS_SEED.find((item) => item.slug === slug);
}
