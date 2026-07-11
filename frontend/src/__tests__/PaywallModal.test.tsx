import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaywallModal } from '../components/PaywallModal';

describe('PaywallModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MemoryRouter>
        <PaywallModal open={false} feature="ai" onClose={() => {}} />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders feature title and upgrade CTA when open', () => {
    render(
      <MemoryRouter>
        <PaywallModal open={true} feature="exchanges" onClose={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText('Больше бирж')).toBeInTheDocument();
    expect(screen.getByText(/Оформить подписку/)).toBeInTheDocument();
    expect(screen.getByText(/Только для подписчиков Pro/)).toBeInTheDocument();
  });

  it('calls onClose when "Не сейчас" clicked', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <PaywallModal open={true} feature="ai" onClose={onClose} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Не сейчас'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
