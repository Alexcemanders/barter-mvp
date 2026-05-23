import axios from 'axios';

const BASE_URL = 'http://192.168.1.50:8000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export type FarmerDTO = {
  VENDOR_ID: string;
  Name: string;
  PRODUCE_GIVING: string;
  PRODUCE_WANTED: string;
  LATITUDE: number;
  LONGITUDE: number;
};

export async function createFarmer(payload: FarmerDTO) {
  const res = await api.post('/farmers', payload);
  return res.data;
}

export async function upsertFarmerByID(vendorID: string, payload: Omit<FarmerDTO, 'VENDOR_ID'>) {
  const res = await api.put(`/farmers/${encodeURIComponent(vendorID)}`, payload);
  return res.data;
}

export async function fetchFarmers(): Promise<FarmerDTO[]> {
  const res = await api.get('/farmers');
  return res.data;
}

export type { TradesSummaryDTO } from './tradesSummary';

export async function fetchTradesSummary(vendorId: string): Promise<import('./tradesSummary').TradesSummaryDTO> {
  const res = await api.get(`/trades/summary/${encodeURIComponent(vendorId)}`);
  return res.data;
}

export async function upsertFarmerLocation(
  vendorId: string,
  payload: { LATITUDE: number; LONGITUDE: number }
): Promise<FarmerDTO> {
  const res = await api.put(`/farmers/${encodeURIComponent(vendorId)}/location`, {
    latitude: payload.LATITUDE,
    longitude: payload.LONGITUDE,
  });
  return res.data;
}

export async function upsertFarmerLocationLegacy(
  vendorId: string,
  payload: { LATITUDE: number; LONGITUDE: number }
): Promise<FarmerDTO> {
  return upsertFarmerLocation(vendorId, payload);
}

// Backwards-compatible alias
export const updateFarmerLocation = upsertFarmerLocationLegacy;
