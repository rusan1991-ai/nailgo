/**
 * Телефон в одном виде.
 *
 * Номер приходит из разных мест: из формы записи клиент может написать
 * «+7 (999) 111-22-33», из сессии приходит «+79991112233», мастер вносит номер
 * вручную. Сравнивать их строками нельзя, поэтому в базе храним канонический
 * вид — цифры с ведущим «+», а сравнения делаем через этот же нормализатор.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/** Одинаковые ли это номера — с учётом формата записи. */
export function samePhone(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}
