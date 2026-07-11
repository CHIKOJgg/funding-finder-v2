import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';

function TestButton() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('Hello', 'success')}>Show</button>;
}

describe('Toast', () => {
  it('renders toast on showToast call', () => {
    render(
      <ToastProvider>
        <TestButton />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show').click();
    });

    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('auto-dismisses after 3 seconds', async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <TestButton />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show').click();
    });

    expect(screen.getByText('Hello')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(screen.queryByText('Hello')).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});

