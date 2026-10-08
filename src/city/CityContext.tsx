/**
 * Город, который человек выбрал при входе на сайт.
 *
 * Храним регион в localStorage и даём его всем страницам: карта на главной
 * и каталог показывают мастеров выбранного региона. Пока выбора не было,
 * по умолчанию открывается Санкт-Петербург.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { safeStorage } from "../utils/storage";

export const CITY_STORAGE_KEY = "nailgo_region";

export type RegionChoice = {
  region: string;
  /** Города внутри региона — показываем их как подпись. */
  cities: string[];
  center: { lat: number; lng: number };
};

/** Города, которые уже охвачены. Значения совпадают с регионами в базе. */
export const DEFAULT_REGIONS: RegionChoice[] = [
  { region: "Санкт-Петербург", cities: ["Санкт-Петербург"], center: { lat: 59.9386, lng: 30.3141 } },
  {
    region: "Ленинградская область",
    cities: ["Всеволожск"],
    center: { lat: 60.0205, lng: 30.636 },
  },
];

export const DEFAULT_REGION = DEFAULT_REGIONS[0].region;

type CityContextValue = {
  region: string;
  /** Был ли человек уже выбран город (иначе интерфейс предлагает выбрать). */
  chosen: boolean;
  setRegion: (region: string) => void;
};

const CityContext = createContext<CityContextValue | undefined>(undefined);

export function CityProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState<string>(() => safeStorage.get(CITY_STORAGE_KEY) ?? DEFAULT_REGION);

  const setRegion = useCallback((next: string) => {
    setRegionState(next);
    safeStorage.set(CITY_STORAGE_KEY, next);
  }, []);

  const value = useMemo<CityContextValue>(
    () => ({
      region,
      chosen: Boolean(safeStorage.get(CITY_STORAGE_KEY)),
      setRegion,
    }),
    [region, setRegion],
  );

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity() {
  const context = useContext(CityContext);
  if (!context) {
    throw new Error("useCity must be used inside CityProvider");
  }
  return context;
}
