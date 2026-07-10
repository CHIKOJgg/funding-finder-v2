import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navigation } from '../components/Navigation';

describe('Navigation', () => {
  it('renders three tabs', () => {
    render(
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    );
    expect(screen.getByText('Главная')).toBeInTheDocument();
    expect(screen.getByText('Арбитраж')).toBeInTheDocument();
    expect(screen.getByText('Профиль')).toBeInTheDocument();
  });

  it('marks active tab based on current route', () => {
    render(
      <MemoryRouter initialEntries={['/arbitrage']}>
        <Navigation />
      </MemoryRouter>
    );
    const arbitrageTab = screen.getByText('Арбитраж');
    expect(arbitrageTab.closest('button')?.className).toContain('text-telegram-blue');
  });
});
