import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="bg-white rounded-xl max-w-sm w-full">
        <div className="card">
          <h2 id="confirm-title" className="text-lg font-semibold mb-2">{title}</h2>
          <p className="text-sm text-gray-600 mb-4">{message}</p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="btn btn-secondary flex-1"
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef}
              onClick={onConfirm}
              className={`btn flex-1 ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

