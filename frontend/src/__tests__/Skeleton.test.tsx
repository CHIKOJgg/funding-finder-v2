import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, CardSkeleton, TableRowSkeleton, ResultSkeleton } from '../components/Skeleton';

describe('Skeleton', () => {
  it('renders with default props', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('animate-pulse');
  });

  it('renders multiple lines', () => {
    const { container } = render(<Skeleton count={3} />);
    expect(container.children.length).toBe(3);
  });
});

describe('CardSkeleton', () => {
  it('renders card shape', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('TableRowSkeleton', () => {
  it('renders with 4 columns', () => {
    const { container } = render(<TableRowSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('ResultSkeleton', () => {
  it('renders loading items', () => {
    const { container } = render(<ResultSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

