import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { formatNumber } from '../utils/formatters';

interface OIRecord {
  id: string;
  timestamp: string;
  openInterestUsd: number;
}

interface LSRRecord {
  id: string;
  timestamp: string;
  longShortRatio: number;
  longAccountRatio?: number;
  shortAccountRatio?: number;
}

interface LiquidationRecord {
  id: string;
  timestamp: string;
  longVolUsd: number;
  shortVolUsd: number;
  price: number;
}

interface MarketData {
  latestOI?: OIRecord | null;
  oiHistory: OIRecord[];
  latestLSR?: LSRRecord | null;
  lsrHistory: LSRRecord[];
  liquidations: LiquidationRecord[];
}

interface MarketDataTableProps {
  exchange: string;
  contract: string;
}

export default function MarketDataTable({ exchange, contract }: MarketDataTableProps) {
  const [data, setData] = useState<MarketData>({
    oiHistory: [],
    lsrHistory: [],
    liquidations: [],
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'oi' | 'lsr' | 'liq'>('oi');

  const fetchData = useCallback(async () => {
    try {
      const [oiRes, lsrRes, liqRes] = await Promise.all([
        apiClient.getLatestOpenInterest(exchange, contract),
        apiClient.getLongShortRatio(exchange, contract),
        apiClient.getLiquidationSnapshots(exchange, contract, 24),
      ]);

      setData({
        latestOI: oiRes ?? null,
        oiHistory: [],
        latestLSR: lsrRes?.latest ?? null,
        lsrHistory: lsrRes?.history ?? [],
        liquidations: liqRes ?? [],
      });
    } catch (err) {
      console.warn('Market data fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [exchange, contract]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 120_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="market-data-table">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-[var(--bg2)] rounded w-1/4" />
          <div className="h-8 bg-[var(--bg2)] rounded" />
          <div className="h-8 bg-[var(--bg2)] rounded" />
          <div className="h-8 bg-[var(--bg2)] rounded" />
        </div>
      </div>
    );
  }

  const oi = data.latestOI;
  const lsr = data.latestLSR;
  const liqs = data.liquidations;
  const liqLong = liqs.reduce((s, l) => s + l.longVolUsd, 0);
  const liqShort = liqs.reduce((s, l) => s + l.shortVolUsd, 0);
  const liqTotal = liqLong + liqShort;

  return (
    <div className="market-data-table bg-[var(--bg1)] rounded-lg p-4 border border-[var(--border)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">Market Depth</h3>
        <div className="flex gap-1">
          {(['oi', 'lsr', 'liq'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 min-h-[44px] text-xs rounded-lg border transition-colors active:opacity-80 ${
                activeTab === tab
                  ? 'bg-[var(--cobalt)] text-white border-[var(--cobalt)]'
                  : 'bg-[var(--bg1)] text-[var(--text2)] border-[var(--border)] active:border-[var(--border-2)]'
              }`}
            >
              {tab === 'oi' ? 'OI' : tab === 'lsr' ? 'L/S' : 'Liq'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'oi' && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text2)]">Open Interest</span>
            <span className="text-[var(--text)] font-mono">
              {oi ? formatNumber(oi.openInterestUsd) : 'N/A'}
            </span>
          </div>
          {oi && oi.openInterestUsd > 0 && (
            <div className="w-full bg-[var(--bg2)] rounded-full h-2">
              <div className="bg-[var(--cobalt)] h-2 rounded-full" style={{ width: '100%' }} />
            </div>
          )}
          <div className="text-xs text-[var(--text3)] mt-1">
            OI snapshot for {exchange}:{contract}
          </div>
        </div>
      )}

      {activeTab === 'lsr' && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text2)]">Long/Short Ratio</span>
            <span className="text-[var(--text)] font-mono">
              {lsr ? `${((lsr?.longShortRatio ?? 0.5) * 100).toFixed(1)}% long` : 'N/A'}
            </span>
          </div>
          {lsr && (
            <>
              <div className="flex gap-2 text-xs">
                <div className="flex-1 bg-[var(--bg2)] rounded-full h-3 relative overflow-hidden">
                  <div
                    className="bg-[var(--green)] h-full absolute left-0 top-0"
                    style={{ width: `${((lsr?.longShortRatio ?? 0.5) * 100)}%` }}
                  />
                  <div
                    className="bg-[var(--red)] h-full absolute top-0"
                    style={{
                      width: `${((1 - (lsr?.longShortRatio ?? 0.5)) * 100)}%`,
                      left: `${((lsr?.longShortRatio ?? 0.5) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs text-[var(--text2)]">
                <span>Long: {((lsr?.longAccountRatio ?? (lsr?.longShortRatio ?? 0.5)) * 100).toFixed(1)}%</span>
                <span>Short: {((lsr?.shortAccountRatio ?? (1 - (lsr?.longShortRatio ?? 0.5))) * 100).toFixed(1)}%</span>
              </div>
            </>
          )}
          {(lsr?.longShortRatio ?? 0) > 0.7 && (
            <div className="text-xs text-[var(--amber)] mt-1">
              Crowded long — potential squeeze risk
            </div>
          )}
          {(lsr?.longShortRatio ?? 1) < 0.3 && (
            <div className="text-xs text-[var(--amber)] mt-1">
              Crowded short — potential squeeze risk
            </div>
          )}
        </div>
      )}

      {activeTab === 'liq' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-[var(--card)] rounded p-2">
              <div className="text-[var(--text2)]">Long Liq</div>
              <div className="text-[var(--green)] font-mono">{formatNumber(liqLong)}</div>
            </div>
            <div className="bg-[var(--card)] rounded p-2">
              <div className="text-[var(--text2)]">Short Liq</div>
              <div className="text-[var(--red)] font-mono">{formatNumber(liqShort)}</div>
            </div>
            <div className="bg-[var(--card)] rounded p-2">
              <div className="text-[var(--text2)]">Total</div>
              <div className="text-[var(--text)] font-mono">{formatNumber(liqTotal)}</div>
            </div>
          </div>
          {liqs.length > 0 && (
            <div className="text-xs text-[var(--text3)]">
              Last: {liqs[0].longVolUsd > liqs[0].shortVolUsd ? 'Long dominant' : 'Short dominant'}
            </div>
          )}
          <div className="text-xs text-[var(--text3)] mt-1">
            {liqs.length} liquidation events in 24h
          </div>
        </div>
      )}
    </div>
  );
}