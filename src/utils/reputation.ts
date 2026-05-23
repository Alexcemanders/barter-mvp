import type { ReputationByVendor, Trade } from '../models/types';

export function defaultReputation(): ReputationByVendor {
  return {};
}

export function applyFeedbackToReputation(
  rep: ReputationByVendor,
  trade: Trade
): ReputationByVendor {
  if (!trade.feedback) return rep;
  const vendor = trade.feedback.otherVendorNumber;
  const current = rep[vendor] ?? 0;

  // simple +/-
  const next = current + (trade.feedback.liked ? 5 : -5);
  return { ...rep, [vendor]: next };
}

export function sortTradesByLocalReputation(
  trades: Array<{ otherVendorNumber: string; matchScore: number }>,
  rep: ReputationByVendor
) {
  return [...trades].sort((a, b) => {
    const ra = rep[a.otherVendorNumber] ?? 0;
    const rb = rep[b.otherVendorNumber] ?? 0;
    if (rb !== ra) return rb - ra;
    return b.matchScore - a.matchScore;
  });
}

