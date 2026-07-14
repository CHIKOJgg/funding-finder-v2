import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaywallModal } from '../components/PaywallModal';

import { LanguageProvider } from '../i18n';

describe('PaywallModal portfolio feature', () => {
  it('renders portfolio feature details and trial CTA', () => {
    render(
      <MemoryRouter>
        <LanguageProvider>
          <PaywallModal open={true} feature="portfolio" onClose={() => {}} />
        </LanguageProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('Симулятор портфеля')).toBeInTheDocument();
    expect(screen.getByText(/Только для подписчиков Pro/)).toBeInTheDocument();
    // Trial CTA is shown as an alternative for portfolio gating
    expect(screen.getByText(/Pro 3 дня бесплатно/)).toBeInTheDocument();
  });
});
