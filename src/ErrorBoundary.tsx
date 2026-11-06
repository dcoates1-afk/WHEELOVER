import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last-resort boundary around the whole app.
 *
 * Without one, an exception thrown while rendering leaves an empty #root: the
 * page keeps whatever title and background the shell gave it, so the failure
 * looks like "the site loaded but the app is blank" with nothing to act on.
 * This renders the error instead, and logs it for the console.
 *
 * It catches render/lifecycle errors only; a rejected promise or a failed
 * fetch is reported by the feature that made it.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[WHEELOVER] render failed', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          boxSizing: 'border-box',
          minHeight: '100vh',
          margin: 0,
          padding: '2.5rem 1.5rem',
          background: '#10151c',
          color: '#e8eef6',
          font: '15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.35rem', fontWeight: 600 }}>
          The chart could not start
        </h1>
        <p style={{ margin: '0 0 1.25rem', color: '#9fb0c4' }}>
          Something failed while drawing the app. Reloading often clears it; if it keeps
          happening, the message below is the cause.
        </p>
        <pre
          style={{
            margin: '0 0 1.25rem',
            padding: '0.9rem 1rem',
            maxHeight: '45vh',
            overflow: 'auto',
            background: '#0a0e13',
            border: '1px solid #22303f',
            borderRadius: 8,
            color: '#ffb4a8',
            font: '13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {error.stack ?? `${error.name}: ${error.message}`}
        </pre>
        <button
          type="button"
          onClick={this.reload}
          style={{
            padding: '0.6rem 1.1rem',
            border: '1px solid #2f4257',
            borderRadius: 6,
            background: '#1b2735',
            color: '#e8eef6',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload the app
        </button>
      </div>
    );
  }
}
