/** Общая загрузка данных из API: состояние + перезагрузка. */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, getAuthScopeVersion, subscribeAuthScope } from "./client";

type State<T> = { data: T | null; loading: boolean; error: string | null };
type KeyedState<T> = State<T> & { key: string | null };
/** К состоянию добавляем перезагрузку — после действий вроде модерации отзыва. */
export type Resource<T> = State<T> & { reload: () => void };

/** Загрузка ресурса: состояние, ошибка и ручная перезагрузка. */
export function useApiResource<T>(path: string | null): Resource<T> {
  const authScope = useSyncExternalStore(subscribeAuthScope, getAuthScopeVersion, getAuthScopeVersion);
  const requestKey = path ? `${authScope}:${path}` : null;
  const [state, setState] = useState<KeyedState<T>>({ key: null, data: null, loading: Boolean(path), error: null });
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!path || !requestKey) {
      setState({ key: null, data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    // Смена сессии/пути синхронно отделяет прошлые private-данные от новой учётки.
    setState({ key: requestKey, data: null, loading: true, error: null });
    void (async () => {
      try {
        const data = await api.get<T>(path);
        if (alive) setState({ key: requestKey, data, loading: false, error: null });
      } catch (error) {
        if (alive) {
          setState({
            key: requestKey,
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : "Ошибка запроса",
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, requestKey, version]);

  // Эффект запускается после рендера; при смене user scope старые данные
  // скрываются уже в этом рендере, не дожидаясь эффекта и нового ответа API.
  const visibleState = state.key === requestKey
    ? state
    : { data: null, loading: Boolean(path), error: null };
  return { ...visibleState, reload };
}
