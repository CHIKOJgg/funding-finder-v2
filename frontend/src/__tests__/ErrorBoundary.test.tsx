import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';

function ThrowError() {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('renders fallback on error', () => {
    // Suppress console.error from React error logging
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText('Обновить страницу')).toBeInTheDocument();
    expect(screen.getByText('На главную')).toBeInTheDocument();

    spy.mockRestore();
  });
});
