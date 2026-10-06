export const masters = [
  {
    slug: "anna-smirnova",
    name: "Анна Смирнова",
    tags: "Маникюр, Наращивание, Дизайн",
    rating: 4.9,
    reviews: 128,
    metro: "м. Тверская",
    distance: "300 м",
    priceFrom: 1500,
    experience: "6 лет",
  },
  {
    slug: "ekaterina-vlasova",
    name: "Екатерина Власова",
    tags: "Маникюр, Педикюр",
    rating: 5,
    reviews: 96,
    metro: "м. Пушкинская",
    distance: "450 м",
    priceFrom: 1800,
    experience: "4 года",
  },
  {
    slug: "maria-ivanova",
    name: "Мария Иванова",
    tags: "Маникюр, Педикюр",
    rating: 4.8,
    reviews: 74,
    metro: "м. Чеховская",
    distance: "600 м",
    priceFrom: 1400,
    experience: "5 лет",
  },
  {
    slug: "olga-kravtsova",
    name: "Ольга Кравцова",
    tags: "Наращивание, Дизайн",
    rating: 4.9,
    reviews: 102,
    metro: "м. Цветной бульвар",
    distance: "700 м",
    priceFrom: 2000,
    experience: "3 года",
  },
];

export const services = [
  { id: "s1", name: "Маникюр классический", duration: "60 мин", price: 1300 },
  { id: "s2", name: "Маникюр + гель-лак", duration: "90 мин", price: 1800 },
  { id: "s3", name: "Наращивание ногтей", duration: "120 мин", price: 2500 },
  { id: "s4", name: "Педикюр + гель-лак", duration: "90 мин", price: 2000 },
  { id: "s5", name: "Дизайн одного ногтя", duration: "15 мин", price: 150 },
];

export const slotDays = [
  { id: "d1", label: "Сегодня", date: "22 мая" },
  { id: "d2", label: "Завтра", date: "23 мая" },
  { id: "d3", label: "Сб", date: "24 мая" },
  { id: "d4", label: "Вс", date: "25 мая" },
];

export const slots = ["18:00", "19:00", "20:00", "21:00"];

export const notifications = [
  { id: "n1", title: "Напоминание о записи", desc: "Завтра в 19:00 у Анны Смирновой", time: "10:00" },
  { id: "n2", title: "Мастер подтвердила запись", desc: "Анна Смирнова подтвердила вашу запись", time: "Вчера" },
  { id: "n3", title: "Свободное окно", desc: "У Анны Смирновой появилось окно на 16:00", time: "09:00" },
  { id: "n4", title: "Спасибо за отзыв", desc: "Ваш отзыв опубликован", time: "10 мая" },
];

export const reviewFeed = [
  { id: "r1", client: "Ксения Л.", score: 5, text: "Отличный мастер. Покрытие держится долго.", date: "22 мая" },
  { id: "r2", client: "Анастасия П.", score: 5, text: "Очень аккуратная работа, уютная студия.", date: "18 мая" },
  { id: "r3", client: "Дарья С.", score: 5, text: "Сделала наращивание супер, форма идеальная.", date: "15 мая" },
];

export const journalCards = [
  { id: "j1", title: "Тренды маникюра весна 2024", tag: "Статьи" },
  { id: "j2", title: "Уход за кутикулой", tag: "Уход" },
  { id: "j3", title: "Как выбрать мастера", tag: "Идеи" },
  { id: "j4", title: "Идеи летнего маникюра", tag: "Тренды" },
];

export const upcomingBookings = [
  {
    id: "b1",
    date: "22 мая, среда",
    time: "19:00",
    master: "Анна Смирнова",
    service: "Маникюр + гель-лак",
    address: "ул. Тверская, 30",
  },
  {
    id: "b2",
    date: "25 мая, суббота",
    time: "18:00",
    master: "Екатерина Власова",
    service: "Наращивание ногтей",
    address: "ул. Пушкинская, 45",
  },
];

export const lastMinuteOffers = [
  {
    id: "o1",
    masterSlug: "anna-smirnova",
    masterName: "Анна Смирнова",
    rating: 4.9,
    district: "Коньково",
    metro: "Беляево",
    distance: "1,2 км",
    service: "Маникюр + гель-лак",
    duration: "90 мин",
    regularPrice: 2500,
    specialPrice: 1900,
    dateLabel: "Сегодня",
    time: "18:30",
  },
  {
    id: "o2",
    masterSlug: "ekaterina-vlasova",
    masterName: "Екатерина Власова",
    rating: 5,
    district: "Тверской",
    metro: "Пушкинская",
    distance: "2,1 км",
    service: "Педикюр + гель-лак",
    duration: "120 мин",
    regularPrice: 3200,
    specialPrice: 2700,
    dateLabel: "Сегодня",
    time: "19:45",
  },
  {
    id: "o3",
    masterSlug: "maria-ivanova",
    masterName: "Мария Иванова",
    rating: 4.8,
    district: "Арбат",
    metro: "Смоленская",
    distance: "2,8 км",
    service: "Маникюр классический",
    duration: "60 мин",
    regularPrice: 1800,
    specialPrice: 1450,
    dateLabel: "Завтра",
    time: "10:30",
  },
];

export function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}