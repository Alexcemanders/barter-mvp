import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import type { TradesSummaryDTO } from '../api/tradesSummary';
import { storageGetString, storageGetJSON, storageSetJSON, KEYS } from '../storage/storage';


import type { TradesSummaryIncomingItemDTO } from '../api/tradesSummary';

// Keep this aligned with the trade row shape used in BarterScreen.
export type BarterTradeRow = {
  trade_id: number | string;
  status: string;
};

type SeenTradeIdsState = string[];

type AcknowledgeIncomingTradesFn = (incomingTrades: TradesSummaryIncomingItemDTO[] | BarterTradeRow[]) => Promise<void>;
type AcknowledgeOutgoingTradesFn = (outgoingTrades: any[]) => Promise<void>;

export type TradeNotifications = {

  seenTradeIds: SeenTradeIdsState;
  hasNewIncoming: boolean;
  acknowledgeIncomingTrades: AcknowledgeIncomingTradesFn;

  hasNewOutgoingAccepted: boolean;
  acknowledgeOutgoingTrades: AcknowledgeOutgoingTradesFn;

  refreshTradesSummary: () => Promise<void>;
  loading: boolean;
};


const STORAGE_KEY_SEEN_INCOMING_TRADE_IDS = 'seen_incoming_trade_ids';
const STORAGE_KEY_SEEN_OUTGOING_TRADE_IDS = 'seen_outgoing_trade_ids';

function coerceTradeIdList(items: Array<{ trade_id: number | string }>): string[] {
  return items.map((t) => String(t.trade_id));
}

export function useTradeNotifications(): TradeNotifications {

  const [seenTradeIds, setSeenTradeIds] = useState<string[]>([]);
  const [seenOutgoingTradeIds, setSeenOutgoingTradeIds] = useState<string[]>([]);
  const [tradesSummary, setTradesSummary] = useState<TradesSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);


  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const vn = await (await storageGetJSON<string | null>(KEYS.vendorNumber)) ?? null;
      // NOTE: KEYS.vendorNumber is stored via storageGetString in existing screens.
      // We keep hydration resilient by falling back to raw string fetch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch {
      // ignore
    }

    // Load seen IDs
    const savedIds = await storageGetJSON<string[]>(STORAGE_KEY_SEEN_INCOMING_TRADE_IDS);
    setSeenTradeIds(Array.isArray(savedIds) ? savedIds.map(String) : []);

    const savedOutgoingIds = await storageGetJSON<string[]>(STORAGE_KEY_SEEN_OUTGOING_TRADE_IDS);
    setSeenOutgoingTradeIds(
      Array.isArray(savedOutgoingIds) ? savedOutgoingIds.map(String) : []
    );

    setLoading(false);
  }, []);


  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const refreshTradesSummary = useCallback(async () => {
    // Get current vendor id
    const vnRaw = await (await import('../storage/storage')).storageGetJSON<string | null>(KEYS.vendorNumber as any).catch(() => null);
    // The codebase actually stores vendorNumber via storageGetString(KEYS.vendorNumber).
    // To avoid breaking, attempt both:
    const { storageGetString } = await import('../storage/storage');
    const vn = vnRaw ?? (await storageGetString(KEYS.vendorNumber));
    if (!vn) return;

    const summary = await api
      .get(`/trades/summary/${encodeURIComponent(String(vn))}?_cb=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      })
      .then((r) => r.data as TradesSummaryDTO);

    setTradesSummary(summary);
  }, []);

  useEffect(() => {
    void refreshTradesSummary();
  }, [refreshTradesSummary]);

  const acknowledgeIncomingTrades: AcknowledgeIncomingTradesFn = useCallback(
    async (incomingTrades) => {
      const ids = coerceTradeIdList(incomingTrades as Array<{ trade_id: number | string }>);
      const next = Array.from(new Set([...seenTradeIds, ...ids]));
      setSeenTradeIds(next);
      await storageSetJSON(STORAGE_KEY_SEEN_INCOMING_TRADE_IDS, next);
    },
    [seenTradeIds]
  );


  const acknowledgeOutgoingTrades: AcknowledgeOutgoingTradesFn = useCallback(
    async (outgoingTrades) => {
      const ids = coerceTradeIdList(outgoingTrades as Array<{ trade_id: number | string }>);
      const next = Array.from(new Set([...(seenOutgoingTradeIds ?? []), ...ids]));
      setSeenOutgoingTradeIds(next);
      await storageSetJSON(STORAGE_KEY_SEEN_OUTGOING_TRADE_IDS, next);
    },
    [seenOutgoingTradeIds]
  );

  const hasNewIncoming = useMemo(() => {
    if (!tradesSummary) return false;
    const pending = tradesSummary.incoming.filter((t) => t.status === 'pending');
    return pending.some((t) => !seenTradeIds.includes(String(t.trade_id)));
  }, [tradesSummary, seenTradeIds]);

  const hasNewOutgoingAccepted = useMemo(() => {
    if (!tradesSummary) return false;
    const accepted = tradesSummary.outgoing.filter((t) => t.status === 'accepted');
    return accepted.some((t) => !seenOutgoingTradeIds.includes(String(t.trade_id)));
  }, [tradesSummary, seenOutgoingTradeIds]);

  return {
    seenTradeIds,
    hasNewIncoming,
    acknowledgeIncomingTrades,
    hasNewOutgoingAccepted,
    acknowledgeOutgoingTrades,
    refreshTradesSummary,
    loading,
  };
}

