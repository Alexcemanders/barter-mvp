import type { OfferItem, UserProfile } from '../models/types';

function makeOffer(id: string, name: string, photos: number[] = []): OfferItem {
  return {
    id,
    name,
    // MVP: keep photos empty in mock data; user will add real photos.
    photos: photos.map((i) => ({ id: `${id}-p${i}`, uri: '' })),
  };
}

export const MOCK_FARMERS: UserProfile[] = [
  {
    vendorNumber: 'VN-1001',
    displayName: 'Amina Farms',
    offers: [makeOffer('o1', 'Tomatoes'), makeOffer('o2', 'Onions')],
    wants: ['Beans', 'Maize'],
  },
  {
    vendorNumber: 'VN-1002',
    displayName: 'Kato Local Goods',
    offers: [makeOffer('o3', 'Beans'), makeOffer('o4', 'Local Honey')],
    wants: ['Tomatoes', 'Eggplants'],
  },
  {
    vendorNumber: 'VN-1003',
    displayName: 'Mariam Produce',
    offers: [makeOffer('o5', 'Eggplants'), makeOffer('o6', 'Maize')],
    wants: ['Onions', 'Tomatoes'],
  },
  {
    vendorNumber: 'VN-1004',
    displayName: 'Orchard Ben',
    offers: [makeOffer('o7', 'Avocados'), makeOffer('o8', 'Local Honey')],
    wants: ['Beans', 'Tomatoes'],
  },
];

