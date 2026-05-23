// Centralized TypeScript types for /trades/summary

export type TradesSummaryIncomingItemDTO = {
  trade_id: number | string;
  from_vendor_id: string;
  from_name: string;
  giving: string;
  receiving: string;
  status: string;
  statusRec: string;
  meeting_name: string;
  meeting_lat: number;
  meeting_lng: number;
  proposed_time?: string;
  Sender_note?: string;
  Reciever_note?: string;
};

export type TradesSummaryOutgoingItemDTO = {
  trade_id: number | string;
  to_vendor_id: string;
  to_name: string;
  giving: string;
  receiving: string;
  status: string;
  statusRec: string;
  meeting_name: string;
  meeting_lat: number;
  meeting_lng: number;
  proposed_time?: string;
  Sender_note?: string;
  Reciever_note?: string;
};


export type TradesSummaryDTO = {
  vendor_id: string;
  incoming: TradesSummaryIncomingItemDTO[];
  outgoing: TradesSummaryOutgoingItemDTO[];
};

