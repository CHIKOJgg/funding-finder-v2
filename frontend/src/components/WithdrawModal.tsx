import { useState } from 'react';
import { useToast } from './Toast';
import { apiClient } from '../api/client';
import { IconX } from './icons';

interface WithdrawModalProps {
  open: boolean;
  balance: number;
  onClose: () => void;
  onSuccess: () => void;
}

const NETWORKS = [
  { id: 'TRC20', name: 'USDT (TRC20 - Tron)', min: 10, placeholder: 'T...' },
  { id: 'BEP20', name: 'USDT (BEP20 - BNB Chain)', min: 10, placeholder: '0x...' },
  { id: 'TON', name: 'USDT (TON)', min: 10, placeholder: 'EQ... or UQ...' },
  { id: 'SOL', name: 'USDT (Solana)', min: 10, placeholder: 'Solana wallet address...' },
  { id: 'ERC20', name: 'USDT (ERC20 - Ethereum)', min: 50, placeholder: '0x...' },
];

export function WithdrawModal({ open, balance, onClose, onSuccess }: WithdrawModalProps) {
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState('TRC20');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  if (!open) return null;

  const currentNetwork = NETWORKS.find((n) => n.id === network) || NETWORKS[0];
  const minAmount = currentNetwork.min;

  const handleMax = () => {
    setAmount(String(Math.floor(balance * 100) / 100));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount < minAmount) {
      showToast(`Минимальная сумма вывода для ${currentNetwork.id}: ${minAmount} USDT`, 'error');
      return;
    }

    if (numAmount > balance) {
      showToast('Недостаточно средств на балансе', 'error');
      return;
    }

    const trimmedAddr = address.trim();
    if (!trimmedAddr || trimmedAddr.length < 8) {
      showToast('Пожалуйста, введите корректный адрес кошелька', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res: any = await apiClient.withdraw(numAmount, 'USDT', trimmedAddr, network);
      if (res?.ok || res?.withdrawal) {
        showToast('Заявка на вывод успешно создана!', 'success');
        onSuccess();
        onClose();
      } else {
        showToast(res?.error || 'Ошибка при создании заявки на вывод', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Ошибка сети при выводе средств', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="card w-full max-w-md p-5 relative overflow-hidden" style={{ background: 'var(--surface)' }}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors p-1"
          aria-label="Закрыть"
        >
          <IconX size={20} />
        </button>

        <h2 className="text-lg font-bold mb-1 text-[var(--text)]">Вывод средств (USDT)</h2>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Вывод реферального вознаграждения и баланса на ваш криптокошелёк
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Доступный баланс:</span>
              <span className="font-semibold text-[var(--text)]">{balance.toFixed(2)} USDT</span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min={minAmount}
                max={balance}
                placeholder={`Мин. ${minAmount} USDT`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field w-full pr-16"
                required
              />
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded text-xs font-bold text-[var(--brand)] bg-[var(--brand-soft)] hover:opacity-80 transition-opacity"
              >
                MAX
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Сеть вывода
            </label>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              className="input-field w-full"
            >
              {NETWORKS.map((net) => (
                <option key={net.id} value={net.id}>
                  {net.name} (мин. {net.min} USDT)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Адрес кошелька ({network})
            </label>
            <input
              type="text"
              placeholder={currentNetwork.placeholder}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input-field w-full font-mono text-xs"
              required
            />
          </div>

          <div className="rounded-lg p-3 text-xs bg-[var(--surface-2)] text-[var(--text-muted)] space-y-1">
            <p>• Заявки обрабатываются администрацией в течение 24 часов.</p>
            <p>• Убедитесь, что выбранная сеть совпадает с сетью вашего кошелька во избежание потери средств.</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1 py-2.5 text-sm"
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5"
              disabled={submitting || balance < minAmount}
            >
              {submitting ? 'Отправка...' : 'Вывести'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
