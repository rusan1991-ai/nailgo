/** Общая загрузка данных из API: состояние + перезагрузка. */
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";

type State<T> = { data: T | null; loading: boolean; error: string | null };
/** К состоянию добавляем перезагрузку — после действий вроде модерации отзыва. */
export type Resource<T> = State<T> & { reload: () => void };

/** Загрузка ресурса: состояние, ошибка и ручная перезагрузка. */

export function useApiResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: Boolean(path), error: null });
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true }));
    void (async () => {
      try {
        const data = await api.get<T>(path);
        if (alive) setState({ data, loading: false, error: null });
      } catch (error) {
        if (alive) {
          setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Ошибка запроса" });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, version]);

  return { ...state, reload };
}

