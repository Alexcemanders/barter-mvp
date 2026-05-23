import type { UserProfile } from '../models/types';

function normalizeItemName(s: string): string {
  return s.trim().toLowerCase();
}

export function computeMatchScore(my: UserProfile, other: UserProfile): {
  score: number;
  offeredWantedIntersection: string[]; // other offers I want
  myOffersOtherWantsIntersection: string[]; // my offers other wants
} {
  const myOffers = new Set(my.offers.map((o) => normalizeItemName(o.name)));
  const otherOffers = new Set(other.offers.map((o) => normalizeItemName(o.name)));

  const myWants = new Set(my.wants.map(normalizeItemName));
  const otherWants = new Set(other.wants.map(normalizeItemName));

  const offeredWantedIntersection: string[] = [];
  for (const item of otherOffers) {
    if (myWants.has(item)) offeredWantedIntersection.push(item);
  }

  const myOffersOtherWantsIntersection: string[] = [];
  for (const item of myOffers) {
    if (otherWants.has(item)) myOffersOtherWantsIntersection.push(item);
  }

  // Simple heuristic: how many items cross each direction.
  // Each cross is worth 10 points.
  const score = offeredWantedIntersection.length * 10 + myOffersOtherWantsIntersection.length * 10;
  return { score, offeredWantedIntersection, myOffersOtherWantsIntersection };
}

export function proposeTrades(my: UserProfile, others: UserProfile[]): Array<{
  other: UserProfile;
  wantedItemName: string; // item you want from other (other offers)
  offeredItemName: string; // item you offer to other (your offers)
  matchScore: number;
}> {
  const out: Array<{
    other: UserProfile;
    wantedItemName: string;
    offeredItemName: string;
    matchScore: number;
  }> = [];

  for (const other of others) {
    const myOffers = my.offers.map((o) => o.name);
    const otherOffers = other.offers.map((o) => o.name);

    const matches = computeMatchScore(my, other);
    if (matches.score <= 0) continue;

    // Try pair one offered item (from my offers that other wants) with one wanted item (from other offers that I want)
    for (const myOfferName of myOffers) {
      if (!other.wants.some((w) => normalizeItemName(w) === normalizeItemName(myOfferName))) continue;
      for (const otherOfferName of otherOffers) {
        if (!my.wants.some((w) => normalizeItemName(w) === normalizeItemName(otherOfferName))) continue;

        out.push({
          other,
          wantedItemName: otherOfferName,
          offeredItemName: myOfferName,
          matchScore: matches.score,
        });
      }
    }
  }

  return out;
}


