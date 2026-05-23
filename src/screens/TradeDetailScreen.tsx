import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import type { Trade, UserProfile } from '../models/types';
import { KEYS, storageGetJSON, storageSetJSON } from '../storage/storage';

import { applyFeedbackToReputation } from '../utils/reputation';
import { theme } from '../theme';

function id() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Camera permission is required.');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets?.[0]?.uri ?? null;
}

export default function TradeDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const tradeId: string = route.params?.tradeId;

  const [trade, setTrade] = useState(null);


  const [otherProfile, setOtherProfile] = useState(null);



  useEffect(() => {
    (async () => {
      const trades = await storageGetJSON<any[]>(KEYS.trades);
      const arr = Array.isArray(trades) ? trades : [];
      const t = arr.find((x) => x.id === tradeId) ?? null;


      setTrade(t);
      // MVP: other profile can be derived from DB, but for now keep null if not cached.
      // (Trade list rendering already shows matching partners.)
      if (t) setOtherProfile(null);

    })();
  }, [tradeId]);

  async function persistTrade(next: Trade) {
    const trades = await storageGetJSON<Trade[]>(KEYS.trades);
    const arr = trades ?? [];
    const updated = arr.map((t) => (t.id === next.id ? next : t));
    await storageSetJSON(KEYS.trades, updated);
    setTrade(next);
  }

  async function completeTrade() {
    if (!trade) return;
    const uri = await takePhoto();
    if (!uri) return;

    const next: Trade = {
      ...trade,
      verificationPhoto: { id: id(), uri },
      completedAt: Date.now(),
    };

    await persistTrade(next);

    // Private feedback prompt (simple local prompt)
    Alert.alert('Trade completed', 'Did you like the produce?', [
      {
        text: 'No',
        style: 'destructive',
        onPress: async () => {
          const feedbackTrade: Trade = {
            ...next,
            feedback: { liked: false, otherVendorNumber: next.otherVendorNumber, at: Date.now() },
          };

          await persistTrade(feedbackTrade);

          const rep = (await storageGetJSON<Record<string, number>>(KEYS.reputation)) ?? {};
          const repNext = applyFeedbackToReputation(rep, feedbackTrade);
          await storageSetJSON(KEYS.reputation, repNext);

          navigation.goBack();
        },
      },
      {
        text: 'Yes',
        onPress: async () => {
          const feedbackTrade: Trade = {
            ...next,
            feedback: { liked: true, otherVendorNumber: next.otherVendorNumber, at: Date.now() },
          };

          await persistTrade(feedbackTrade);

          const rep = (await storageGetJSON<Record<string, number>>(KEYS.reputation)) ?? {};
          const repNext = applyFeedbackToReputation(rep, feedbackTrade);
          await storageSetJSON(KEYS.reputation, repNext);

          navigation.goBack();
        },
      },
    ]);
  }

  const meetingText = useMemo(() => {
    if (!trade) return '';
    const p = trade.meetingLocation.point;
    return `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;
  }, [trade]);

  if (!trade || !otherProfile) {
    return (
      <View style={styles.center}>
        <Text>Loading trade...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Trade Detail</Text>

      <View style={styles.card}>
        <Text style={styles.name}>{otherProfile.displayName}</Text>
        <Text style={styles.muted}>Vendor: {trade.otherVendorNumber}</Text>
        <Text style={styles.row}>You give: <Text style={{ fontWeight: '800' }}>{trade.offeredItemName}</Text></Text>
        <Text style={styles.row}>You get: <Text style={{ fontWeight: '800' }}>{trade.wantedItemName}</Text></Text>

        <Text style={[styles.muted, { marginTop: 8 }]}>Meeting: {trade.meetingLocation.label ?? 'Meet here'}</Text>
        <Text style={styles.muted}>{meetingText}</Text>
      </View>

      {trade.verificationPhoto?.uri ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Verification photo</Text>
          <Image source={{ uri: trade.verificationPhoto.uri }} style={styles.photo} />
          <Text style={styles.muted}>Completed: {trade.completedAt ? new Date(trade.completedAt).toLocaleString() : ''}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Complete trade</Text>
          <Text style={styles.muted}>Take a verification picture to confirm the exchange.</Text>
          <TouchableOpacity onPress={completeTrade} style={styles.cta}>
            <Text style={styles.ctaText}>Take verification photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {trade.feedback ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your feedback (stored locally)</Text>
          <Text style={styles.row}>
            Liked: <Text style={{ fontWeight: '800', color: trade.feedback.liked ? theme.colors.primaryDark : theme.colors.danger }}>{String(trade.feedback.liked)}</Text>
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: theme.colors.bg, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: theme.colors.text },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14 },
  name: { fontSize: 20, fontWeight: '900', marginBottom: 2 },
  muted: { color: theme.colors.muted },
  row: { marginTop: 6, color: theme.colors.text },
  photo: { width: '100%', height: 260, borderRadius: 12, marginTop: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 6 },
  cta: { marginTop: 12, backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '900' },
});

