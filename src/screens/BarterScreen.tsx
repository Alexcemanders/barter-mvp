import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RootTabParamList } from '../navigation/BottomTabs';

import type { OfferItem, UserProfile } from '../models/types';
import { proposeTrades } from '../utils/matching';

import { KEYS, storageGetJSON, storageGetString, storageSetJSON } from '../storage/storage';
import { useTradeNotifications } from '../hooks/useTradeNotifications';


import { fetchFarmers } from '../api/client';
import { fetchTradesSummary, updateFarmerLocation } from '../api/client';
import { api } from '../api/client';
import type { TradesSummaryDTO } from '../api/tradesSummary';

import { theme } from '../theme';

import { ImageBackground } from 'react-native';
const barterBg = require('../../assets/images/forbarter.png');


function clampQty(qty: number) {
  if (!Number.isFinite(qty)) return 1;
  if (qty < 1) return 1;
  return qty;
}

function csvToArray(csv: string): string[] {

  if (!csv) return [];
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

type SegmentKey = 'available' | 'incoming' | 'outgoing';

type OverpassAmenity = {
  id: number;
  type: 'node';
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OverpassAmenity[];
};

type BarterTradeRow = {
  trade_id: number | string;
  from_vendor_id?: string;
  from_name?: string;
  to_vendor_id?: string;
  to_name?: string;
  giving: string;
  receiving: string;
  status: 'pending' | 'accepted' | 'declined' | string;
  meeting_name: string;
  meeting_lat: number;
  meeting_lng: number;
  proposed_time?: string;
};

export default function BarterScreen() {
  const [segment, setSegment] = useState<SegmentKey>('available');

  // --- Fair exchange valuation state (take-it-or-leave-it UI) ---
  // NOTE: Proposal UI now lives in ProposeTradeScreen overlay (not in this modal).
  // Keeping this screen focused on listing/proposal launching.



  const route = useRoute<any>();

  const navigation = useNavigation<any>();

  const lastAmenityFetchAbort = useRef<AbortController | null>(null);

  

  


  

  
  const {
    hasNewIncoming,
    hasNewOutgoingAccepted,
    acknowledgeIncomingTrades,
    acknowledgeOutgoingTrades,
  } = useTradeNotifications();



  const [myVendorNumber, setMyVendorNumber] = useState<string>('');
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [allFarmers, setAllFarmers] = useState<UserProfile[]>([]);

  const [reputation, setReputation] = useState<Record<string, number>>({});
  const [tradesSummary, setTradesSummary] = useState<TradesSummaryDTO | null>(null);

  // Local-only personalized ratings for sorting available barters
  // Stored on-device only (per requirements).
  const [localFarmerRatings, setLocalFarmerRatings] = useState<Record<string, number>>({});

  // Available matchmaking proposals
  const displayTrades = useMemo(() => {
    if (!myProfile) return [];
    const others = allFarmers.filter((f) => f.vendorNumber !== myVendorNumber);
    if (others.length === 0) return [];

    const proposals = proposeTrades(myProfile, others);

    const enriched = proposals.map((p) => ({
      key: `${p.other.vendorNumber}|${p.offeredItemName}|${p.wantedItemName}`,
      otherVendorNumber: p.other.vendorNumber,
      other: p.other,
      offeredItemName: p.offeredItemName,
      wantedItemName: p.wantedItemName,
      matchScore: p.matchScore,
      reputationScore: reputation[p.other.vendorNumber] ?? 0,
    }));

    // Personalized client-side rating sort:
    // If you haven't rated a farmer yet, default their score to 5.
    // Descending: highest ratings stay at the top.
    const sortedByLocalRating = [...enriched].sort((a, b) => {
      const scoreA = localFarmerRatings[a.other.vendorNumber] ?? 5;
      const scoreB = localFarmerRatings[b.other.vendorNumber] ?? 5;
      return scoreB - scoreA;
    });

    // Keep a stable-ish secondary ordering for ties:
    sortedByLocalRating.sort((a, b) => {
      const scoreA = localFarmerRatings[a.other.vendorNumber] ?? 5;
      const scoreB = localFarmerRatings[b.other.vendorNumber] ?? 5;

      if (scoreB !== scoreA) return scoreB - scoreA;

      if (b.reputationScore !== a.reputationScore) return b.reputationScore - a.reputationScore;
      return b.matchScore - a.matchScore;
    });

    return sortedByLocalRating;
  }, [myProfile, myVendorNumber, reputation, allFarmers, localFarmerRatings]);

  const incomingQueue = useMemo(() => tradesSummary?.incoming ?? [], [tradesSummary]);
  const outgoingQueue = useMemo(() => tradesSummary?.outgoing ?? [], [tradesSummary]);



  // Load state on focus
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const vn = await storageGetString(KEYS.vendorNumber);
        if (!vn) return;
        setMyVendorNumber(vn);

        const rep = await storageGetJSON<Record<string, number>>(KEYS.reputation);
        setReputation((rep ?? {}) as Record<string, number>);

        // Personalized local ratings (on-device only)
        try {
          const raw = await AsyncStorage.getItem('local_farmer_ratings');
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, number>;
            setLocalFarmerRatings(parsed ?? {});
          } else {
            setLocalFarmerRatings({});
          }
        } catch {
          setLocalFarmerRatings({});
        }

        // Queues - Forced cache busting parameters attached to standard headers
        try {
          console.log('📡 HYDRATING QUEUES ON SCREEN FOCUS');
          const summary = await api.get(`/trades/summary/${vn}?_cb=${Date.now()}`, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
            }
          }).then(res => res.data);

          setTradesSummary(summary);
        } catch {
          setTradesSummary(null);
        }

        // Profiles for matchmaking + explicit coordinate hydration for proposal validation
        try {
          const farmers = await fetchFarmers();

          const toUserProfile = (f: (typeof farmers)[number]): UserProfile => {
            const offers = csvToArray(f.PRODUCE_GIVING);
            const wants = csvToArray(f.PRODUCE_WANTED);

            return {
              vendorNumber: f.VENDOR_ID,
              displayName: f.Name,
              offers: offers.map((name) => ({ id: `giving-${f.VENDOR_ID}-${name}`, name, photos: [] })),
              wants,
              latitude: Number(f.LATITUDE) || 0.0,
              longitude: Number(f.LONGITUDE) || 0.0,
            };
          };

          // Explicitly fetch/hydrate my farmer profile first
          const me = farmers.find((f) => f.VENDOR_ID === vn);
          if (me) {
            const hydratedMe = toUserProfile(me);
            setMyProfile(hydratedMe);
          } else {
            setMyProfile(null);
          }

          // Then load all farmers for matchmaking
          setAllFarmers(farmers.map(toUserProfile));
        } catch {
          setAllFarmers([]);
          setMyProfile(null);
        }
      })();
    }, [])
  );

  // --- Server-driven proposal modal ---
  const [proposalModalVisible, setProposalModalVisible] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<'idle' | 'sent'>('idle');

  const [proposalOtherVendor, setProposalOtherVendor] = useState<UserProfile | null>(null);
  const [proposalOfferedItem, setProposalOfferedItem] = useState<string>('');
  const [proposalWantedItem, setProposalWantedItem] = useState<string>('');
  const [senderNoteDraft, setSenderNoteDraft] = useState<string>('');

  const [amenitiesLoading, setAmenitiesLoading] = useState(false);

  const [amenities, setAmenities] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [selectedAmenity, setSelectedAmenity] = useState<{ name: string; lat: number; lng: number } | null>(null);

  const [meetingDateTime, setMeetingDateTime] = useState<Date>(() => new Date(Date.now() + 60 * 60 * 1000));
  const [dayPickerOpen, setDayPickerOpen] = useState(false);

  const [desiredQuantity, setDesiredQuantity] = useState<number>(1);

  const [marketRates, setMarketRates] = useState<
    Record<string, { display: string; unit: string; price: number }>
  >({});

  // Fetch market rates for live valuation summary.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await api.get('/market/rates', {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        });
        const data = (res.data ?? {}) as Record<string, { display: string; unit: string; price: number }>;
        if (!cancelled) setMarketRates(data);
      } catch {
        if (!cancelled) setMarketRates({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const offered_item = proposalOfferedItem;
  const wanted_item = proposalWantedItem;
  const qty = desiredQuantity;

  const meetingDateString = meetingDateTime.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const hour24 = meetingDateTime.getHours();
  const minute = meetingDateTime.getMinutes();
  const proposed_time = meetingDateTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  const offeredKey = String(offered_item || '').toLowerCase().trim();
  const wantedKey = String(wanted_item || '').toLowerCase().trim();

  const offeredData = marketRates[offeredKey];
  const wantedData = marketRates[wantedKey];

  const [evaluationSummary] = useState(() => ({
    error: false,
  }));

  const { calculatedGiveQty, items_receiving, items_giving, wanted_unit, offered_unit } = useMemo(() => {
    // Critical: no fallbacks. If either rate is missing, mark error.
    if (!wantedData || !offeredData) {
      return {
        calculatedGiveQty: NaN,
        items_receiving: '',
        items_giving: '',
        wanted_unit: wantedData?.unit || 'units',
        offered_unit: offeredData?.unit || 'units',
      };
    }

    const wanted_unit = wantedData?.unit || 'units';
    const offered_unit = offeredData?.unit || 'units';

    const calculatedGiveQty = Math.round((wantedData.price * qty) / offeredData.price);

    const items_receiving = `${qty} ${wanted_unit} of ${wanted_item}`;
    const items_giving = `${calculatedGiveQty} ${offered_unit} of ${offered_item}`;

    return { calculatedGiveQty, items_receiving, items_giving, wanted_unit, offered_unit };
  }, [offeredData, wantedData, qty, wanted_item, offered_item]);

  // Compute error gate explicitly for JSX; no hidden state.
  const evaluationError = !offeredData || !wantedData;

  const evaluationSummaryMemo = useMemo(() => {
    return { error: evaluationError };
  }, [evaluationError]);

  // (Legacy, not currently used) midpoint calc for proposals.

  const midpointForProposal = useCallback(() => {
    if (!myProfile || !proposalOtherVendor) return null;

    const myLat = typeof myProfile.latitude === 'number' ? myProfile.latitude : 0;
    const myLng = typeof myProfile.longitude === 'number' ? myProfile.longitude : 0;
    const otherLat = typeof proposalOtherVendor.latitude === 'number' ? proposalOtherVendor.latitude : 0;
    const otherLng = typeof proposalOtherVendor.longitude === 'number' ? proposalOtherVendor.longitude : 0;

    if (!myLat || !myLng || !otherLat || !otherLng) return null;

    return {
      lat: (myLat + otherLat) / 2,
      lng: (myLng + otherLng) / 2,
    };
  }, [myProfile, proposalOtherVendor]);

  // Refreshes backend pipeline without caching pitfalls
  const refreshQueues = useCallback(async () => {
    if (!myVendorNumber) return;
    try {
      console.log('🔄 REFRESHING TRADES SUMMARY VIA EXPLICIT NETWORK HOPS');
      const summary = await api.get(`/trades/summary/${myVendorNumber}?_cb=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        }
      }).then(res => res.data);
      setTradesSummary(summary);
    } catch {
      setTradesSummary(null);
    }
  }, [myVendorNumber]);

  const [proposedVendorIds, setProposedVendorIds] = useState<string[]>([]);

  const sendProposal = useCallback(async () => {
    if (!myVendorNumber || !proposalOtherVendor || !selectedAmenity) return;

    if (!senderNoteDraft.trim()) {
      Alert.alert('Missing sender note', 'Please type how you can be recognized (Sender note) before sending.');
      return;
    }

    setProposalStatus('sent');

    try {
      // Fair exchange quantity math (take-it-or-leave-it).
      // Legacy flow previously sent raw offered/wanted item names.
      // Now we format `items_giving` and `items_receiving` as strings containing quantities.
      // Backend expects: YYYY-MM-DD HH:MM:SS (no manual stepping by day needed)
      const pad = (n: number) => String(n).padStart(2, '0');
      const proposed_time = `${meetingDateTime.getFullYear()}-${pad(meetingDateTime.getMonth() + 1)}-${pad(meetingDateTime.getDate())} ${pad(meetingDateTime.getHours())}:${pad(meetingDateTime.getMinutes())}:00`;


      // Use backend rates once per proposal send.
      // Note: this keeps the modal logic intact while enabling deterministic pricing.
      const ratesRes = await api.get('/market/rates', { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' } });
      const rates = (ratesRes.data ?? {}) as Record<string, { display: string; unit: string; price: number }>;

      // For matchmaking we only have item *names*; normalize to backend rate keys.
      const offeredKey = String(proposalOfferedItem ?? '').toLowerCase().trim();
      const wantedKey = String(proposalWantedItem ?? '').toLowerCase().trim();

      const offered = rates[offeredKey];
      const wanted = rates[wantedKey];

      // Desired quantity selected in the modal UI.
      const safeDesiredQuantity = clampQty(desiredQuantity);

      const offeredPrice = offered?.price ?? 1;
      const wantedPrice = wanted?.price ?? 1;

      const rawGiveQty = (wantedPrice * safeDesiredQuantity) / offeredPrice;
      const calculatedGiveQty = Math.round(rawGiveQty);


      const offered_unit = offered?.unit ?? 'unit';
      const offered_item = offered?.display ?? String(proposalOfferedItem ?? '');

      const wanted_unit = wanted?.unit ?? 'unit';
      const wanted_item = wanted?.display ?? String(proposalWantedItem ?? '');

      const itemsGiving = `${calculatedGiveQty} ${offered_unit} of ${offered_item}`;
      const itemsReceiving = `${desiredQuantity} ${wanted_unit} of ${wanted_item}`;

      const payload = {
        sender_id: myVendorNumber,
        receiver_id: proposalOtherVendor.vendorNumber,
        Sender_note: senderNoteDraft,
        items_giving: itemsGiving,
        items_receiving: itemsReceiving,
        meeting_name: selectedAmenity.name,
        meeting_lat: selectedAmenity.lat,
        meeting_lng: selectedAmenity.lng,
        proposed_time,
      };

      await api.post('/trades/propose', payload);
      setProposedVendorIds((prev) => [...prev, proposalOtherVendor.vendorNumber]);


      // Indexing sync delay fallback
      setTimeout(async () => {
        await refreshQueues();
      }, 400);

      setProposalModalVisible(false);
      Alert.alert('Sent!', 'Your trade proposal was sent successfully.');
    } catch {
      setProposalStatus('idle');
      Alert.alert('Error', 'Failed to send proposal.');
    }
  }, [myVendorNumber, proposalOtherVendor, selectedAmenity, proposalOfferedItem, proposalWantedItem, meetingDateTime, refreshQueues, senderNoteDraft]);


  const fetchNearbyLocations = useCallback(async (midLat: number, midLng: number) => {
    try {
      const lat = Number(midLat);
      const lng = Number(midLng);

      const minLng = lng - 0.07;
      const maxLng = lng + 0.07;
      const minLat = lat - 0.07;
      const maxLat = lat + 0.07;

      const url = `https://nominatim.openstreetmap.org/search?q=supermarket&format=json&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=1&limit=10&_cb=${Date.now()}`;

      console.log('🚀 TRIGGERING FRESH NOMINATIM FETCH FOR LOCATION:', lat, lng);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FarmTraderMobileApp/1.2 (Production Mobile Barter Integration)',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });

      if (res.status === 403 || !res.ok) {
        console.log('⚠️ Nominatim fallback triggered, status: ' + res.status);
        return [{ id: 'midpoint-fallback', name: 'Suggested Midpoint Hub (Raw Coordinates)', lat, lng }];
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return [{ id: 'midpoint-fallback', name: 'Suggested Midpoint Hub (Raw Coordinates)', lat, lng }];
      }

      return data
        .filter((item: any) => {
          const name = typeof item?.name === 'string' ? item.name.trim() : '';
          const lower = name.toLowerCase();
          return name.length > 0 && lower !== 'empty building' && lower !== 'vacant' && lower !== 'unnamed';
        })
        .map((item: any, index: number) => {
          const shortName = item.name || (item.display_name ? item.display_name.split(',')[0] : '') || 'Local Grocery Hub';
          return {
            id: item.place_id?.toString() || index.toString(),
            name: shortName,
            lat: Number(item.lat),
            lng: Number(item.lon),
          };
        });
    } catch (error) {
      console.error('❌ Nominatim Fetch Error:', error);
      return [{ id: 'midpoint-fallback', name: 'Suggested Midpoint Hub (Raw Coordinates)', lat: Number(midLat), lng: Number(midLng) }];
    }
  }, []);

  const openProposalForAvailableCard = useCallback(
    async (item: {
      other: UserProfile;
      offeredItemName: string;
      wantedItemName: string;
    }) => {
      if (!myVendorNumber) return;

      setProposalStatus('idle');
      setSenderNoteDraft('');
      setAmenities([]);
      setSelectedAmenity(null);


      setProposalOtherVendor(item.other);
      setProposalOfferedItem(item.offeredItemName);
      setProposalWantedItem(item.wantedItemName);

      // Render proposal UI in a dedicated overlay screen so edits in ProposeTradeScreen show up.
      setProposalModalVisible(false);
      setAmenitiesLoading(true);

      // Proposal overlay now lives fully inside BarterScreen.
      // Keep legacy modal visible shell, but render the full propose UI inside it.
      setProposalModalVisible(true);

      // Kick off amenity lookup (existing legacy code below was previously unreachable).
      // We'll reuse it by removing the early return below.



      try {
        const farmers = await fetchFarmers();
        const meRow = farmers.find((f) => f.VENDOR_ID === myVendorNumber);
        const otherRow = farmers.find((f) => f.VENDOR_ID === item.other.vendorNumber);

        const meLat = Number(meRow?.LATITUDE ?? 0);
        const meLng = Number(meRow?.LONGITUDE ?? 0);
        const otherLat = Number(otherRow?.LATITUDE ?? 0);
        const otherLng = Number(otherRow?.LONGITUDE ?? 0);

        const hasValid =
          Number.isFinite(meLat) &&
          Number.isFinite(meLng) &&
          Number.isFinite(otherLat) &&
          Number.isFinite(otherLng) &&
          !(meLat === 0.0 && meLng === 0.0) &&
          !(otherLat === 0.0 && otherLng === 0.0);

        if (!hasValid) {
          Alert.alert(
            'Location not available',
            'Base locations are required to propose a meeting point.'
          );
          setProposalModalVisible(false);
          return;
        }

        const midLat = (meLat + otherLat) / 2;
        const midLng = (meLng + otherLng) / 2;

        lastAmenityFetchAbort.current?.abort();
        const controller = new AbortController();
        lastAmenityFetchAbort.current = controller;

        const results = await fetchNearbyLocations(midLat, midLng);

        const byName = new Map<string, { name: string; lat: number; lng: number }>();
        for (const a of results) {
          if (!byName.has(a.name)) byName.set(a.name, { name: a.name, lat: a.lat, lng: a.lng });
          if (byName.size >= 4) break;
        }

        const list = Array.from(byName.values());
        setAmenities(list);
        setSelectedAmenity(list[0] ?? null);
      } catch {
        const fallback = [{ name: 'Meet here', lat: 0, lng: 0 }];
        setAmenities(fallback);
        setSelectedAmenity(fallback[0]);
        Alert.alert('Overpass lookup failed', 'Using a fallback meeting point.');
      } finally {
        setAmenitiesLoading(false);
      }
    },
    [myVendorNumber, fetchNearbyLocations]
  );

  const [recieverNotesDrafts, setRecieverNotesDrafts] = useState<Record<string, string>>({});

  // ---- Trade completion + rating modal (local-only storage) ----
  const [isRatingModalVisible, setIsRatingModalVisible] = useState(false);
  const [selectedTradeForRating, setSelectedTradeForRating] = useState<any>(null);

  useEffect(() => {
    const trigger = (route as any)?.params?.triggerRatingForTrade;
    if (!trigger) return;

    setSelectedTradeForRating(trigger);
    setIsRatingModalVisible(true);

    // prevent re-trigger loops (bypass TS params typing)
    // no-op: avoid re-trigger loops. (Safe guard handled by modal close & route param clearing in native nav layers.)
  }, [route]);

  const submitTradeCompletionAndRating = useCallback(
    async (score: number) => {
      if (!selectedTradeForRating) return;

      const { tradeId, otherTraderId } = selectedTradeForRating as {
        tradeId: number | string;
        otherTraderId: string;
      };

      const safeOtherId = String(otherTraderId);
      const safeTradeId = String(tradeId);

      try {
        // 1) Read existing ratings object from AsyncStorage
        const raw = await AsyncStorage.getItem('local_farmer_ratings');
        const existing = raw ? (JSON.parse(raw) as Record<string, number>) : {};

        // 2) Save updated dictionary object back
        const updated = {
          ...(existing ?? {}),
          [safeOtherId]: score,
        };
        await AsyncStorage.setItem('local_farmer_ratings', JSON.stringify(updated));

        // 3) Send API call to mark trade completed.
        // IMPORTANT: backend uses a specific completion role; we must request the correct one.
        // We infer which role the current user is from the trade row we are completing.
        const allTradesForStatus = [...(tradesSummary?.incoming ?? []), ...(tradesSummary?.outgoing ?? [])] as any[];
        const row = allTradesForStatus.find((x) => String(x.trade_id) === safeTradeId);

        // For /trades/summary payloads:
        // - In outgoing rows, `to_vendor_id` is the receiver and this user is the sender.
        // - In incoming rows, `from_vendor_id` is the sender and this user is the receiver.
        // - `status` updates the sender/proposer field.
        // - `statusRec` updates the receiver field.
        const isOutgoingRow = String(row?.to_vendor_id ?? '') === String(tradesSummary?.vendor_id ?? '');
        const isSender = String(row?.from_vendor_id ?? myVendorNumber) === String(myVendorNumber) || isOutgoingRow;

        const payload = isSender ? { status: 'completed' } : { statusRec: 'completed' };

        await api.put(`/trades/${encodeURIComponent(safeTradeId)}/status`, payload);

        // 4) Hide modal and refresh
        setIsRatingModalVisible(false);
        setSelectedTradeForRating(null);
        await refreshQueues();
      } catch {
        // Requirements: do not navigate; keep local UI behavior stable.
      }
    },
    [selectedTradeForRating, refreshQueues]
  );

  const updateIncomingStatus = useCallback(
    async (tradeId: number | string, nextStatus: 'accepted' | 'declined') => {
      try {
        const body: any = { status: nextStatus };
        if (nextStatus === 'accepted') {
          body.Reciever_note = recieverNotesDrafts[String(tradeId)] ?? '';
        }

        const isReceiver = true; // updateIncomingStatus is used only in the incoming/receiver context
        if (isReceiver) {
          await api.put(`/trades/${encodeURIComponent(String(tradeId))}/status`, { ...body, statusRec: nextStatus });
        } else {
          await api.put(`/trades/${encodeURIComponent(String(tradeId))}/status`, body);
        }

        const freshSummary = await api.get(`/trades/summary/${myVendorNumber}?_cb=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        }).then(res => res.data);
        setTradesSummary(freshSummary);
      } catch {
        Alert.alert('Error', 'Could not update trade status.');
      }
    },
    [myVendorNumber, recieverNotesDrafts]
  );


  const outgoingBadgedColor = (status: string) => {
    if (status === 'accepted') return styles.badgeAccepted;
    if (status === 'declined') return styles.badgeDeclined;
    return styles.badgePending;
  };

  if (!myProfile) {
    return (
      <View style={styles.center}>
        <Text>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ImageBackground
      source={barterBg}
      style={{ flex: 1 }}
      imageStyle={{ opacity: 1, resizeMode: 'cover' }}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
      >
      <Text style={styles.title}>Barter</Text>


      <View style={styles.segmentWrap}>
        <View style={styles.segmentRow}>
          {([
            ['available', 'Available'],
            ['incoming', 'Incoming'],
            ['outgoing', 'Outgoing'],
          ] as const).map(([key, label]) => {
            const active = segment === key;
            const isIncoming = key === 'incoming';

            return (
              <TouchableOpacity
                key={key}
                onPress={() => {
                  setSegment(key);

                  if (key === 'incoming') {
                    void acknowledgeIncomingTrades(incomingQueue);
                  }

                  if (key === 'outgoing') {
                    void acknowledgeOutgoingTrades(outgoingQueue);
                  }
                }}
                style={[styles.segmentBtn, active ? styles.segmentBtnActive : styles.segmentBtnInactive]}
              >

                <Text style={[styles.segmentBtnText, active ? styles.segmentBtnTextActive : undefined]}>
                  {label}{(key === 'incoming' && hasNewIncoming) || (key === 'outgoing' && hasNewOutgoingAccepted) ? ' ❗️' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {segment === 'available' ? (
        <View>
          <Text style={styles.sectionTitle}>Matched traders</Text>
          {displayTrades.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>No matching traders yet</Text>
            </View>
          ) : null}
          {displayTrades.map((t) => (
            <View key={t.key} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View>
                  <Text style={styles.cardTitle}>{t.other.displayName}</Text>
                  <Text style={styles.muted}>Vendor: {t.other.vendorNumber}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Rep {t.reputationScore}</Text>
                </View>
              </View>

              <Text style={styles.row}>
                You give: <Text style={styles.bold}>{t.offeredItemName}</Text>
              </Text>
              <Text style={styles.row}>
                You get: <Text style={styles.bold}>{t.wantedItemName}</Text>
              </Text>
              <Text style={styles.muted}>Match score: {t.matchScore}</Text>

              {(() => {
                const isProposed = proposedVendorIds.includes(t.other.vendorNumber);

                return (
                  <TouchableOpacity
                    style={[
                      styles.proposeButton,
                      isProposed ? { backgroundColor: '#9ca3af', opacity: 0.7 } : undefined,
                    ]}
                    onPress={() => {
                      if (isProposed) return;
                      void openProposalForAvailableCard({
                        other: t.other,
                        offeredItemName: t.offeredItemName,
                        wantedItemName: t.wantedItemName,
                      });
                    }}
                    disabled={isProposed}
                  >
                    <Text style={styles.ctaText}>{isProposed ? 'Sent!' : 'Propose Trade'}</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
          ))}
        </View>
      ) : null}

      {segment === 'incoming' ? (
        <View>
          <Text style={styles.sectionTitle}>Incoming requests</Text>
          {incomingQueue.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>No incoming trade requests</Text>
            </View>
          ) : null}
          {incomingQueue
            .filter((t) => {
              // Receiver queue visibility is controlled ONLY by statusRec.
              // Rule: trade disappears only when *receiver* sets statusRec to 'completed' or 'cancelled'.
              if (t.statusRec === 'completed' || t.statusRec === 'cancelled' || t.statusRec === 'declined') return false;
              return true;
            })
            .map((t) => (
              <View key={String(t.trade_id)} style={styles.card}>
                <Text style={styles.cardTitle}>{t.from_name ?? 'Vendor'}</Text>
                <Text style={styles.muted}>From: {t.from_vendor_id}</Text>

                <Text style={styles.row}>
                  They give: <Text style={styles.bold}>{t.giving}</Text>
                </Text>
                <Text style={styles.row}>
                  They want: <Text style={styles.bold}>{t.receiving}</Text>
                </Text>

                <Text style={styles.muted}>{t.proposed_time ? `Proposed: ${t.proposed_time}` : 'Proposed time: —'}</Text>
                <Text style={styles.muted}>Meeting: {t.meeting_name}</Text>

                {t.status === 'accepted' || t.status === 'completed' ? (
                  <View style={{ marginTop: 10 }}>

                    <Text style={{ fontWeight: '900', color: '#16a34a' }}>
                      You can recognize your fellow farmer by: {t.Sender_note ?? '—'}
                    </Text>

                    <View style={styles.acceptedButtonsRow}>
                      <TouchableOpacity
                        onPress={() => {
                          navigation.navigate('Map');
                        }}
                        style={[styles.sendBtn, { marginTop: 12, flex: 1 }]}
                      >
                        <Text style={styles.sendBtnText}>GET ME THERE!</Text>
                      </TouchableOpacity>
                    <TouchableOpacity
                    onPress={async () => {
                      await api.put(`/trades/${t.trade_id}/status`, { status: 'cancelled' });
                      await refreshQueues();
                    }}
                    style={[styles.sendBtn, { backgroundColor: '#fee2e2', borderColor: '#fca5a5', marginTop: 8 }]}
                  >
                    <Text style={[styles.sendBtnText, { color: '#b91c1c' }]}>Cancel Trade</Text>
                  </TouchableOpacity>    
                    </View>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.modalLabel}>How can the proposer recognize you?</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., Driving a silver truck"
                      value={recieverNotesDrafts[String(t.trade_id)] ?? ''}
                      onChangeText={(txt) =>
                        setRecieverNotesDrafts((prev) => ({
                          ...prev,
                          [String(t.trade_id)]: txt,
                        }))
                      }
                      multiline
                    />

                    <View style={styles.incomingButtons}>
                      <TouchableOpacity
                        onPress={() => updateIncomingStatus(t.trade_id, 'accepted')}
                        style={[styles.incomingBtn, styles.btnAccept]}
                      >
                        <Text style={styles.incomingBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => updateIncomingStatus(t.trade_id, 'declined')}
                        style={[styles.incomingBtn, styles.btnDecline]}
                      >
                        <Text style={styles.incomingBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
        </View>
      ) : null}

      {segment === 'outgoing' ? (
        <View>
          <Text style={styles.sectionTitle}>Outgoing requests</Text>
          {outgoingQueue.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>No outgoing trade requests</Text>
            </View>
          ) : null}
          {outgoingQueue
            .filter((t) => {
              // Sender queue visibility is controlled ONLY by status.
              // Rule: trade disappears only when *sender* sets status to 'completed' or 'cancelled'.
              if (t.status === 'completed' || t.status === 'cancelled') return false;
              return true;
            })
            .map((t) => (
              <View key={String(t.trade_id)} style={styles.card}>
                {(t.status === 'accepted' || t.status === 'completed') ? (

                  <View style={{ marginBottom: 6 }}>
                    <Text style={{ fontWeight: '900', color: '#16a34a' }}>
                      You can recognize your fellow farmer by: {t.Sender_note ?? '—'}
                    </Text>

                    <View style={styles.acceptedButtonsRow}>
                      <TouchableOpacity
                        onPress={() => {
                          navigation.navigate('Map');
                        }}
                        style={[styles.sendBtn, { marginTop: 12, flex: 1 }]}
                      >
                        <Text style={styles.sendBtnText}>GET ME THERE!</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
                <TouchableOpacity
  onPress={async () => {
    await api.put(`/trades/${t.trade_id}/status`, { statusRec: 'cancelled' });
    await refreshQueues();
  }}
  style={[styles.sendBtn, { backgroundColor: '#fee2e2', borderColor: '#fca5a5', marginTop: 8 }]}
>
  <Text style={[styles.sendBtnText, { color: '#b91c1c' }]}>Cancel Trade</Text>
</TouchableOpacity>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <View>
                    <Text style={styles.cardTitle}>
                      {t.to_name ?? 'Vendor'}
                      {t.status === 'pending' && hasNewIncoming ? ' ❗️' : ''}
                    </Text>
                    <Text style={styles.muted}>To: {t.to_vendor_id}</Text>
                  </View>
                  <View style={[styles.badgeStatus, outgoingBadgedColor(t.status)]}>
                    <Text style={styles.badgeStatusText}>{t.status}</Text>
                  </View>
                </View>

                <Text style={styles.row}>
                  You give: <Text style={styles.bold}>{t.giving}</Text>
                </Text>
                <Text style={styles.row}>
                  You want: <Text style={styles.bold}>{t.receiving}</Text>
                </Text>

                <Text style={styles.muted}>{t.proposed_time ? `Proposed: ${t.proposed_time}` : 'Proposed time: —'}</Text>
                <Text style={styles.muted}>Meeting: {t.meeting_name}</Text>
              </View>
            ))}
        </View>
      ) : null}

      <Modal visible={proposalModalVisible} transparent animationType="slide" onRequestClose={() => setProposalModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose meetup</Text>
            <Text style={styles.modalMuted}>Meet with {proposalOtherVendor?.displayName ?? 'vendor'}</Text>

            <Text style={styles.modalLabel}>1) How can the trader recognize you?</Text>
            <TextInput
              style={[styles.input, { backgroundColor: '#fff' }]}
              placeholder="e.g., Driving a silver truck"
              value={senderNoteDraft}
              onChangeText={setSenderNoteDraft}
              multiline
            />

            <Text style={styles.modalLabel}>2) Choose a location</Text>

            {amenitiesLoading ? <Text style={styles.muted}>Searching nearby…</Text> : null}

            {amenities.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {amenities.map((a) => {
                  const active = selectedAmenity?.name === a.name;
                  return (
                    <TouchableOpacity key={a.name} onPress={() => setSelectedAmenity(a)} style={[styles.chip, active ? styles.chipActive : undefined]}>
                      <Text style={[styles.chipText, active ? styles.chipTextActive : undefined]}>{a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.muted}>No public amenities found (try again).</Text>
            )}

            <Text style={[styles.modalLabel, { marginTop: 12 }]}>2) Pick date & time</Text>

            {/* One-click calendar day selector (platform-friendly: simple modal list) */}
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => {
                // Simple clean picker: use the device DatePicker semantics by opening a modal-less day list.
                // We keep it surgical/legacy-friendly: no new dependencies.
                // Target: choose a date in one tap.
                setDayPickerOpen(true);
              }}
            >
              <Text style={styles.datePickerButtonText}>{meetingDateTime.toDateString()}</Text>
            </TouchableOpacity>

            {dayPickerOpen ? (
              <View style={styles.dayPickerGrid}>
                {(() => {
                  const base = new Date(meetingDateTime);
                  const day0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
                  const days = Array.from({ length: 14 }).map((_, i) => {
                    const d = new Date(day0);
                    d.setDate(day0.getDate() + i);
                    return d;
                  });

                  return days.map((d) => {
                    const active = d.toDateString() === new Date(meetingDateTime).toDateString();
                    return (
                      <TouchableOpacity
                        key={d.toISOString()}
                        style={[styles.dayChip, active ? styles.dayChipActive : undefined]}
                        onPress={() => {
                          setMeetingDateTime((prev) => {
                            const next = new Date(prev);
                            next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                            return next;
                          });
                          setDayPickerOpen(false);
                        }}
                      >

                        <Text style={[styles.dayChipText, active ? styles.dayChipTextActive : undefined]}>
                          {d.toLocaleDateString(undefined, { weekday: 'short' })}
                        </Text>
                        <Text style={[styles.dayChipText, active ? styles.dayChipTextActive : undefined]}>
                          {d.getDate()}
                        </Text>
                      </TouchableOpacity>
                    );
                  });
                })()}

                <TouchableOpacity style={styles.dayPickerClose} onPress={() => setDayPickerOpen(false)}>
                  <Text style={styles.dayPickerCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* LIVE VALUATION LEDGER */}
            <View style={{ borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 12, padding: 12 }}>
              {/* Keep only the exchange direction labels per requirements */}
              {evaluationError ? (
                <Text style={{ fontWeight: '900', color: '#b91c1c', marginTop: 6 }}>
                  Pricing error: missing market rates for these items.
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: evaluationError ? 10 : 0 }}>
                <Text style={{ fontWeight: '900', color: theme.colors.muted, flex: 1 }}>You Will Receive:</Text>
                <Text style={{ fontWeight: '900', color: theme.colors.text, textAlign: 'right', flex: 1 }}>{qty} {wanted_unit} of {wanted_item}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 10 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ fontWeight: '900', color: theme.colors.muted, flex: 1 }}>You Must Give:</Text>
                <Text style={{ fontWeight: '900', color: theme.colors.text, textAlign: 'right', flex: 1 }}>{calculatedGiveQty} {offered_unit} of {offered_item}</Text>
              </View>
            </View>

            {/* QUANTITY selection (how many to receive) */}
            <View style={{ marginTop: 10 }}>
              <Text style={{ fontWeight: '900', color: theme.colors.muted, marginBottom: 6, fontSize: 12 }}>
                Quantity
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>


                <TouchableOpacity
                  onPress={() => {
                    setDesiredQuantity((q: number) => Math.max(1, q - 1));
                  }}
                  style={[styles.tsstepBtn, styles.tsstepBtnSmall]}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease desired quantity"
                >
                  <Text style={{ fontSize: 26, fontWeight: '900', color: theme.colors.text }}>-</Text>
                </TouchableOpacity>


                <Text style={styles.stepperValue}>{desiredQuantity}</Text>

                <TouchableOpacity
                  onPress={() => {
                    setDesiredQuantity((q: number) => q + 1);
                  }}
                  style={[styles.tsstepBtn, styles.tsstepBtnSmall]}

                  accessibilityRole="button"
                  accessibilityLabel="Increase desired quantity"
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>

              </View>
            </View>

            {/* Hour + Minute steppers in 24h format */}
            <View style={{ marginTop: 10 }}>
              <Text style={styles.dateText}>
                {meetingDateTime.toDateString()} • {meetingDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </Text>

              <View style={{ flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {/* Hours row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '900', color: theme.colors.text }}>Hours</Text>
                    <Text style={{ fontWeight: '800', color: theme.colors.muted, fontSize: 12 }}>
                      (24h format: 13 = 1 PM, 14 = 2 PM, etc.)
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.ghostBtn]}
                      onPress={() => {
                        setMeetingDateTime((d) => {
                          const next = new Date(d);
                          next.setHours((next.getHours() + 23) % 24);
                          return next;
                        });
                      }}
                    >
                      <Text style={styles.smallBtnText}>-</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]} onPress={() => {}}>
                      <Text style={styles.smallBtnText}>{String(meetingDateTime.getHours()).padStart(2, '0')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallBtn, styles.ghostBtn]}
                      onPress={() => {
                        setMeetingDateTime((d) => {
                          const next = new Date(d);
                          next.setHours((next.getHours() + 1) % 24);
                          return next;
                        });
                      }}
                    >
                      <Text style={styles.smallBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Minutes row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '900', color: theme.colors.text }}>Minutes</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.ghostBtn]}
                      onPress={() => {
                        setMeetingDateTime((d) => {
                          const next = new Date(d);
                          next.setMinutes((next.getMinutes() + 59) % 60);
                          return next;
                        });
                      }}
                    >
                      <Text style={styles.smallBtnText}>-</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]} onPress={() => {}}>
                      <Text style={styles.smallBtnText}>{String(meetingDateTime.getMinutes()).padStart(2, '0')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallBtn, styles.ghostBtn]}
                      onPress={() => {
                        setMeetingDateTime((d) => {
                          const next = new Date(d);
                          next.setMinutes((next.getMinutes() + 1) % 60);
                          return next;
                        });
                      }}
                    >
                      <Text style={styles.smallBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>


            <TouchableOpacity
              style={[styles.sendBtn, proposalStatus === 'sent' ? { opacity: 0.7 } : undefined]}
              onPress={() => {
                if (proposalStatus === 'sent') return;
                void sendProposal();
              }}
              disabled={proposalStatus === 'sent'}
            >
              <Text style={styles.sendBtnText}>{proposalStatus === 'sent' ? 'Sent!' : 'Send Proposal'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border }]}
              onPress={() => setProposalModalVisible(false)}
            >
              <Text style={[styles.sendBtnText, { color: theme.colors.primaryDark }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isRatingModalVisible} transparent animationType="fade" onRequestClose={() => { setIsRatingModalVisible(false); setSelectedTradeForRating(null); }}>
        <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rate your experience with this trader (1-5)</Text>

            {(() => {
              const tradeId = String(selectedTradeForRating?.tradeId ?? '');
              const allTrades = [...(tradesSummary?.incoming ?? []), ...(tradesSummary?.outgoing ?? [])];
              const row = allTrades.find((x) => String(x.trade_id) === tradeId);
              const tStatus = row?.status;

              const shouldDisable = tStatus === 'completed' && row?.statusRec === 'completed';

              if (!shouldDisable) {
                return (
                  <>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, justifyContent: 'space-between' }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <TouchableOpacity
                          key={n}
                          style={styles.scoreBtn}
                          onPress={() => {
                            void submitTradeCompletionAndRating(n);
                          }}
                        >
                          <Text style={styles.scoreBtnText}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.sendBtn, { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginTop: 12 }]}
                      onPress={() => {
                        setIsRatingModalVisible(false);
                        setSelectedTradeForRating(null);
                      }}
                    >
                      <Text style={[styles.sendBtnText, { color: theme.colors.primaryDark }]}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                );
              }

              return (
                <>
                  <Text style={{ marginTop: 12, fontWeight: '900', color: '#f59e0b' }}>Waiting for peer review...</Text>

                  <TouchableOpacity
                    style={[
                      styles.sendBtn,
                      {
                        marginTop: 12,
                        backgroundColor: '#9ca3af',
                        borderWidth: 1,
                        borderColor: '#9ca3af',
                        opacity: 0.85,
                      },
                    ]}
                    disabled
                  >
                    <Text style={[styles.sendBtnText, { color: '#fff' }]}>Waiting for peer review...</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.sendBtn, { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginTop: 12 }]}
                    onPress={() => {
                      setIsRatingModalVisible(false);
                      setSelectedTradeForRating(null);
                    }}
                  >
                    <Text style={[styles.sendBtnText, { color: theme.colors.primaryDark }]}>Close</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: 'transparent', gap: 12 },
  scroll: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  title: { fontSize: 26, fontWeight: '800', color: theme.colors.text },

  segmentWrap: {
    marginTop: 8,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 6,
  },
  segmentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
  segmentBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  segmentBtnInactive: { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
  segmentBtnText: { fontWeight: '900', color: theme.colors.text },
  segmentBtnTextActive: { color: '#fff' },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginTop: 10 },

  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginTop: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  muted: { color: theme.colors.muted, fontWeight: '700' },
  row: { fontSize: 14, color: theme.colors.text },
  bold: { fontWeight: '900' },

  badge: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  badgeText: { color: theme.colors.primaryDark, fontWeight: '800' },

  proposeButton: {
    marginTop: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '800' },

  incomingButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  incomingBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  btnAccept: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  btnDecline: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
  incomingBtnText: { fontWeight: '900', color: theme.colors.text },

  badgeStatus: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  badgeStatusText: { fontWeight: '900', color: theme.colors.text },
  badgePending: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  badgeAccepted: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  badgeDeclined: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  modalTitle: { fontWeight: '900', fontSize: 18, color: theme.colors.text },
  modalMuted: { color: theme.colors.muted, fontWeight: '700' },
  modalLabel: { fontWeight: '900', color: theme.colors.text, marginTop: 6 },
  dateText: { fontWeight: '900', color: theme.colors.text, flex: 1 },

  datePickerButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  datePickerButtonText: { fontWeight: '900', color: theme.colors.text },

  dayPickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dayChipActive: { borderColor: theme.colors.primary, backgroundColor: '#ecfdf5' },
  dayChipText: { fontWeight: '900', color: theme.colors.text },
  dayChipTextActive: { color: theme.colors.primaryDark },
  dayPickerClose: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    width: '100%',
  },
  dayPickerCloseText: { fontWeight: '900', color: theme.colors.primaryDark },


  chip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { borderColor: theme.colors.primary, backgroundColor: '#ecfdf5' },
  chipText: { fontWeight: '900', color: theme.colors.text },
  chipTextActive: { color: theme.colors.primaryDark },

  sendBtn: {
    marginTop: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  sendBtnText: { color: '#fff', fontWeight: '900' },

  acceptedButtonsRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  completeBtn: {
    marginTop: 10,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  completeBtnText: { color: '#fff', fontWeight: '900' },

  scoreBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  scoreBtnActive: {
    borderColor: '#16a34a',
    backgroundColor: '#dcfce7',
  },
  scoreBtnText: { fontWeight: '900', color: theme.colors.text },
  scoreBtnTextActive: { color: '#16a34a' },

  tsstepBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Used by the Quantity +/- stepper buttons.
  tsstepBtnSmall: {
    width: 44,
    height: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },

  stepperValue: {
    fontSize: 22,
    fontWeight: '900',
    color: theme.colors.text,
    minWidth: 40,
    textAlign: 'center',
  },

  stepBtnText: {
    fontSize: 26,
    fontWeight: '900',
    color: theme.colors.text,
  },

  smallBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  smallBtnText: { fontWeight: '900', color: theme.colors.text },
  ghostBtn: { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontWeight: '800',
  },

});