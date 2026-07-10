import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} title="Test" message="Test" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and message when open', () => {
    render(
      <ConfirmDialog open={true} title="Delete?" message="Are you sure?" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open={true} title="Test" message="Test" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.click(screen.getByText('Подтвердить'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open={true} title="Test" message="Test" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText('Отмена'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom button text', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Test"
        message="Test"
        confirmText="Yes"
        cancelText="No"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('uses danger variant class', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Test"
        message="Test"
        variant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const btn = screen.getByText('Подтвердить');
    expect(btn.className).toContain('btn-danger');
  });
});
