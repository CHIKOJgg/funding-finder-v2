import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PullToRefresh } from '../components/PullToRefresh';
import { IconArrowDown, IconPause, IconPlay, Icon, IconName } from '../components/icons';

describe('icon crash regression', () => {
  it('renders IconArrowDown without throwing', () => {
    render(<IconArrowDown size={18} aria-hidden />);
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('renders IconPause and IconPlay without throwing', () => {
    render(<IconPause size={16} />);
    render(<IconPlay size={16} />);
    expect(document.querySelectorAll('svg').length).toBe(2);
  });

  it('renders PullToRefresh wrapper without throwing', () => {
    render(
      <PullToRefresh onRefresh={vi.fn()}>
        <div>content</div>
      </PullToRefresh>
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('returns null for unknown icon name instead of throwing', () => {
    const { container } = render(<Icon name={"DoesNotExist" as IconName} />);
    expect(container.innerHTML).toBe('');
  });
});
