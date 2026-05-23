export type MoneyMakerPhoto = {
  id: string;
  uri: string; // local URI (file://...)
};

export type OfferItem = {
  id: string;
  name: string;
  photos: MoneyMakerPhoto[];
};

export type UserProfile = {
  vendorNumber: string;
  displayName: string;
  offers: OfferItem[];
  wants: string[]; // list of item names accepted
  meetingRadiusKm?: number;
  latitude?: number;
  longitude?: number;
};

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type MeetingLocation = {
  id: string;
  label?: string;
  point: GeoPoint;
};

export type Trade = {
  id: string;
  myVendorNumber: string;
  otherVendorNumber: string;

  offeredItemName: string;
  wantedItemName: string;

  meetingLocation: MeetingLocation;

  // completion artifacts
  verificationPhoto?: MoneyMakerPhoto;
  completedAt?: number;

  // feedback
  feedback?: {
    liked: boolean;
    otherVendorNumber: string;
    at: number;
  };
};

export type ReputationByVendor = Record<string, number>; // simple local score

