import { Component, ErrorInfo, ReactNode } from 'react';
import { useT } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ error }: { error: Error | null }) {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="card max-w-md w-full text-center">
        <h2 className="text-xl font-bold text-red-500 mb-2">{t('errorBoundary.title')}</h2>
        <p className="text-muted mb-4">
          {t('errorBoundary.message')}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="btn btn-primary"
          >
            {t('errorBoundary.reload')}
          </button>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="btn btn-secondary"
          >
            {t('errorBoundary.home')}
          </button>
        </div>
        {import.meta.env.DEV && error && (
          <pre className="mt-4 text-xs text-left bg-red-50 p-2 rounded overflow-auto max-h-40">
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}

