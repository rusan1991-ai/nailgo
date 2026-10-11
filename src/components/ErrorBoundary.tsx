import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Ловит ошибки рендера и показывает их на экране вместо пустой страницы.
 * Без этого любое исключение в React 19 размонтирует всё дерево —
 * снаружи это выглядит как белый экран без объяснений.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Nail 2 Go: ошибка рендера", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="min-h-dvh bg-[#fff7fa] p-6 text-slate-800">
        <div className="mx-auto max-w-2xl rounded-3xl border border-[#f1dde6] bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
          <h1 className="mt-3 text-2xl font-semibold">Что-то сломалось на этой странице</h1>
          <p className="mt-2 text-sm text-slate-500">
            Ошибка перехвачена, чтобы вы видели причину, а не пустой экран. Попробуйте вернуться на главную
            — если ошибка повторяется, текст ниже поможет её починить.
          </p>

          <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-rose-200">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/"
              className="rounded-xl bg-pink-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pink-600"
            >
              На главную
            </a>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-xl border border-[#f2dfe7] px-5 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      </main>
    );
  }
}
