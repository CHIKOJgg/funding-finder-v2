import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <div className="card max-w-md w-full text-center">
            <h2 className="text-xl font-bold text-red-500 mb-2">Что-то пошло не так</h2>
            <p className="text-gray-600 mb-4">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="btn btn-primary"
              >
                Обновить страницу
              </button>
              <button
                onClick={() => { window.location.href = '/'; }}
                className="btn btn-secondary"
              >
                На главную
              </button>
            </div>
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-4 text-xs text-left bg-red-50 p-2 rounded overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

