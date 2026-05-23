import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';

import { theme } from '../theme';
import type { GeoPoint } from '../models/types';
import { KEYS, storageGetString } from '../storage/storage';
import { fetchTradesSummary, upsertFarmerLocation } from '../api/client';
import type { TradesSummaryDTO } from '../api/tradesSummary';
import { api } from '../api/client';

function computeCenterBetween(a: GeoPoint, b: GeoPoint): GeoPoint {

  return {
    latitude: (a.latitude + b.latitude) / 2,
    longitude: (a.longitude + b.longitude) / 2,
  };
}

function toRegion(point: GeoPoint): Region {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };
}

export default function MapScreen() {
  const navigation = useNavigation<any>();
  const [myVendorNumber, setMyVendorNumber] = useState('');

  // User location (for regular mode + centering in accepted mode)
  const [userPoint, setUserPoint] = useState<GeoPoint>({ latitude: 7.8731, longitude: 80.7718 });

  // Accepted trade (navigation mode)
  // Accepted trade (navigation mode)
  const [acceptedTrade, setAcceptedTrade] = useState<{
    meeting_lat: number;
    meeting_lng: number;
    meeting_name: string;
    from_name?: string;
    giving?: string;
    receiving?: string;
    Sender_note?: string;
    Reciever_note?: string;
    role?: 'sender' | 'receiver';
  } | null>(null);


  const [activeTradeId, setActiveTradeId] = useState<string | number | null>(null);


  // Regular mode base location setting
  const [settingBaseLocation, setSettingBaseLocation] = useState(false);
  const [draftPoint, setDraftPoint] = useState<GeoPoint>(userPoint);

  const mapCenter = useMemo(() => {
    if (acceptedTrade) {
      return computeCenterBetween(userPoint, {
        latitude: acceptedTrade.meeting_lat,
        longitude: acceptedTrade.meeting_lng,
      });
    }
    return userPoint;
  }, [acceptedTrade, userPoint]);

  const onOpenInMaps = useCallback(() => {
    if (!acceptedTrade) return;
    const lat = acceptedTrade.meeting_lat;
    const lng = acceptedTrade.meeting_lng;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  }, [acceptedTrade]);

  async function requestAndLoadUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location permission required', 'Enable location permissions to center the map.');
      return;
    }

    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setUserPoint({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
  }

  async function loadTradesSummary(vendorId: string) {
    const summary: TradesSummaryDTO = await fetchTradesSummary(vendorId);

    // 1. Check Incoming Queue (Current User = Receiver)
    const activeIncoming = (summary.incoming ?? []).find((t) => {
      const isReceiverDone = t.statusRec === 'completed' || t.statusRec === 'cancelled';
      const isTradeActive = t.status === 'accepted' || t.status === 'completed';
      return !isReceiverDone && isTradeActive;
    });

    // 2. Check Outgoing Queue (Current User = Sender)
    const activeOutgoing = (summary.outgoing ?? []).find((t) => {
      const isSenderDone = t.status === 'completed' || t.status === 'cancelled';
      const isTradeActive = t.status === 'accepted' || t.statusRec === 'completed';
      return !isSenderDone && isTradeActive;
    });

    // If neither queue has an active navigation trade, clear map state
    if (!activeIncoming && !activeOutgoing) {
      setAcceptedTrade(null);
      setActiveTradeId(null);
      return;
    }

    // Determine active trade and current user's role
    const activeMapTrade = activeIncoming || activeOutgoing;
    const userRole = activeIncoming ? 'receiver' : 'sender';
    const tradeId = (activeMapTrade as any).trade_id ?? (activeMapTrade as any).id ?? null;
    
    setActiveTradeId(tradeId);
    setAcceptedTrade({
      meeting_lat: activeMapTrade.meeting_lat,
      meeting_lng: activeMapTrade.meeting_lng,
      meeting_name: activeMapTrade.meeting_name,
      from_name: 'from_name' in activeMapTrade ? activeMapTrade.from_name : ('to_name' in activeMapTrade ? (activeMapTrade as any).to_name : undefined),
      giving: 'giving' in activeMapTrade ? activeMapTrade.giving : undefined,
      receiving: 'receiving' in activeMapTrade ? activeMapTrade.receiving : undefined,
      Sender_note: 'Sender_note' in activeMapTrade ? (activeMapTrade as any).Sender_note : undefined,
      Reciever_note: 'Reciever_note' in activeMapTrade ? (activeMapTrade as any).Reciever_note : undefined,
      role: userRole,
    });
  }


  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const vn = await storageGetString(KEYS.vendorNumber);
        if (!vn) return;
        setMyVendorNumber(vn);

        // Always load location for map centering (regular mode and accepted mode).
        await requestAndLoadUserLocation();

        // Check accepted navigation mode.
        try {
          await loadTradesSummary(vn);
        } catch {
          // If backend fails, fall back to regular mode.
          setAcceptedTrade(null);
        }
      })();
    }, [])
  );

  useEffect(() => {
    if (!settingBaseLocation) return;
    // Keep draft synced when entering setting mode.
    setDraftPoint(userPoint);
  }, [settingBaseLocation, userPoint]);

  const region = useMemo(() => toRegion(mapCenter), [mapCenter]);

  const TopRightButton = !acceptedTrade ? (
    <TouchableOpacity
      onPress={() => setSettingBaseLocation(true)}
      style={styles.topRight}
      accessibilityRole="button"
    >
      <Text style={styles.topRightText}>Set Base Location</Text>
    </TouchableOpacity>
  ) : null;

  const acceptedMarker = acceptedTrade ? (
    <Marker
      coordinate={{ latitude: acceptedTrade.meeting_lat, longitude: acceptedTrade.meeting_lng }}
      title={acceptedTrade.meeting_name}
      pinColor={theme.colors.primary}
    />
  ) : null;

  const baseMarker = settingBaseLocation ? (
    <Marker
      coordinate={draftPoint}
      draggable
      onDragEnd={(e) => {
        const coord = e.nativeEvent.coordinate;
        setDraftPoint({ latitude: coord.latitude, longitude: coord.longitude });
      }}
    />
  ) : (
    // In regular mode we still allow tapping map to adjust draft point if user starts setting.
    null
  );

  async function applyBaseLocation() {
    if (!myVendorNumber) {
      Alert.alert('Not ready', 'Complete onboarding first.');
      return;
    }

    try {
      await upsertFarmerLocation(myVendorNumber, {
        LATITUDE: draftPoint.latitude,
        LONGITUDE: draftPoint.longitude,
      });
      Alert.alert('Saved', 'Your base location was updated.');
      setSettingBaseLocation(false);
      // keep map centered on new base
      setUserPoint(draftPoint);
    } catch {
      Alert.alert('Error', 'Failed to update location.');
    }
  }

  const banner = settingBaseLocation ? (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>Drag map or tap to place your vendor/home pin.</Text>
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map</Text>

      {banner}
      {TopRightButton}

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          region={region}
          onRegionChangeComplete={() => {
            // no-op
          }}
          zoomEnabled
          scrollEnabled
          rotateEnabled
          pitchEnabled
          showsUserLocation={!acceptedTrade && !settingBaseLocation}
          onPress={(e: any) => {
            if (!settingBaseLocation) return;
            const coord = e.nativeEvent?.coordinate;
            if (!coord) return;
            setDraftPoint({ latitude: coord.latitude, longitude: coord.longitude });
          }}
        >
          {acceptedMarker}
          {settingBaseLocation ? baseMarker : baseMarker}
          {!settingBaseLocation && !acceptedTrade ? null : null}
        </MapView>
      </View>

      {!acceptedTrade && settingBaseLocation ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity onPress={applyBaseLocation} style={[styles.bottomBtn, styles.primaryBtn]}>
            <Text style={styles.bottomBtnText}>Apply Changes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setSettingBaseLocation(false);
              setDraftPoint(userPoint);
            }}
            style={[styles.bottomBtn, styles.ghostBtn]}
          >
            <Text style={[styles.bottomBtnText, { color: theme.colors.primaryDark }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {acceptedTrade ? (
        <View style={styles.bottomCard}>
          <Text style={styles.cardTitle}>{acceptedTrade.meeting_name}</Text>
          <Text style={styles.cardMuted}>
            Meeting at {acceptedTrade.meeting_lat.toFixed(4)}, {acceptedTrade.meeting_lng.toFixed(4)}
          </Text>
          <Text style={styles.cardMuted}>
            {acceptedTrade.from_name ? `Meeting with ${acceptedTrade.from_name}.` : 'Trade meetup is set.'}
          </Text>

          <View style={{ height: 8 }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onOpenInMaps} style={[styles.openMapsBtn, { flex: 1 }]}>
              <Text style={styles.openMapsText}>Open in Maps</Text>
            </TouchableOpacity>

            {/* Rating + completion is handled from the sender/receiver side in BarterScreen.
                The Map tab must always show the “Complete Trade” action. */}
            <TouchableOpacity
              onPress={() => {
                if (!activeTradeId) return;

                // Navigate back to Barter and trigger the rating modal instantly.
                // Pass the trade row so BarterScreen's useEffect can open the modal.
                navigation.navigate('Barter' as never, {
                  triggerRatingForTrade: {
                    tradeId: activeTradeId,
                    // For accepted trade, MapScreen has `from_name`; use it as the other trader id if available.
                    // If from_vendor_id isn't present in the payload, ratings fallback will be a no-op.
                    otherTraderId: String((acceptedTrade as any)?.from_vendor_id ?? (acceptedTrade as any)?.from_name ?? ''),
                    timestamp: Date.now(),
                  },
                } as never);
              }}
              style={[styles.completeTradeBtn, { flex: 1 }]}
            >
              <Text style={styles.completeTradeText}>Complete Trade</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.recognitionText}>
            You can recognize your fellow farmer by: {acceptedTrade.role === 'receiver'
              ? (acceptedTrade.Sender_note ?? '—')
              : (acceptedTrade.Reciever_note ?? '—')}
          </Text>

          <View style={{ height: 10 }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={async () => {
                if (!activeTradeId || !acceptedTrade) return;
                try {
                  // Determine payload based on whether you are the sender or receiver
                  const payload = (acceptedTrade as any).role === 'receiver'
                    ? { statusRec: 'cancelled' }
                    : { status: 'cancelled' };

                  await api.put('/trades/' + activeTradeId + '/status', payload);
                  setAcceptedTrade(null);
                  setActiveTradeId(null);
                } catch {
                  Alert.alert('Error', 'Failed to cancel trade.');
                }
              }}
              style={[styles.cancelTradeBtn, { flex: 1 }]}
            >
              <Text style={styles.cancelTradeText}>Cancel Trade</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.bg },
  title: { fontSize: 26, fontWeight: '800', color: theme.colors.text, marginBottom: 4 },
  mapWrap: {
    flex: 1,
    marginTop: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  map: { width: '100%', height: '100%' },

  topRight: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    zIndex: 10,
  },
  topRightText: { fontWeight: '800', color: theme.colors.primaryDark },

  banner: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 12,
    padding: 10,
    zIndex: 11,
  },
  bannerText: { fontWeight: '800', color: '#9a3412' },

  bottomBar: {
    paddingVertical: 12,
    gap: 10,
    paddingHorizontal: 4,
  },
  bottomBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  primaryBtn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  ghostBtn: { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
  bottomBtnText: { fontWeight: '900', color: '#fff' },

  bottomCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 14,
    zIndex: 20,
  },
  cardTitle: { fontWeight: '900', fontSize: 16, color: theme.colors.text },
  cardMuted: { color: theme.colors.muted, marginTop: 4, fontWeight: '700' },

  openMapsBtn: {
    marginTop: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  openMapsText: { color: '#fff', fontWeight: '900' },

  cancelTradeBtn: {
    marginTop: 10,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  cancelTradeText: {
    color: '#b91c1c',
    fontWeight: '900',
  },

  // Added for consistent completion entry on the Map tab.
  completeTradeBtn: {
    marginTop: 10,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  completeTradeText: {
    color: '#fff',
    fontWeight: '900',
  },
  recognitionText: {
    marginTop: 10,
    color: '#16a34a',
    fontWeight: '900',
  },
});



