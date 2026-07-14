import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaywallModal } from '../components/PaywallModal';

import { LanguageProvider } from '../i18n';

describe('PaywallModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MemoryRouter>
        <LanguageProvider>
          <PaywallModal open={false} feature="ai" onClose={() => {}} />
        </LanguageProvider>
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders feature title and upgrade CTA when open', () => {
    render(
      <MemoryRouter>
        <LanguageProvider>
          <PaywallModal open={true} feature="exchanges" onClose={() => {}} />
        </LanguageProvider>
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
        <LanguageProvider>
          <PaywallModal open={true} feature="ai" onClose={onClose} />
        </LanguageProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Не сейчас'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
