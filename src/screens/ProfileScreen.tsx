import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';


import { useNavigation } from '@react-navigation/native';

import type { UserProfile } from '../models/types';

import { KEYS, storageGetJSON, storageGetString, storageSetJSON } from '../storage/storage';
import { theme } from '../theme';
import { upsertFarmerByID } from '../api/client';
const profileBg = require('../../assets/images/profile-bg.jpg');
const offerBg = require('../../assets/images/offer-bg.png');
const wantBg = require('../../assets/images/want-bg.png');
const PRESET_CROPS = [
  { label: 'Tomatoes', emoji: '🍅' },
  { label: 'Corn', emoji: '🌽' },
  { label: 'Eggs', emoji: '🥚' },
  { label: 'Potatoes', emoji: '🥔' },
  { label: 'Honey', emoji: '🍯' },
  { label: 'Milk', emoji: '🥛' },
  { label: 'Apples', emoji: '🍎' },
  { label: 'Berries', emoji: '🍓' },
] as const;

function id() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function toCSV(items: string[]): string {
  return items.map((s) => s.trim()).filter(Boolean).join(',');
}

export default function ProfileScreen({ onSignOut }: { onSignOut?: () => void }) {
  const navigation = useNavigation();
  const [vendorNumber, setVendorNumber] = useState('');
  const [myProfile, setProfile] = useState<UserProfile | null>(null);





  useEffect(() => {
    (async () => {
      const vn = await storageGetString(KEYS.vendorNumber);
      if (!vn) return;
      setVendorNumber(vn);

      // Resolve profile from local storage cache first (safe + fast).
      try {
        const cached: unknown = await storageGetJSON(KEYS.profileByVendor(vn));
        const cachedProfile = cached as Partial<UserProfile> | null;
        const cachedDisplayName = typeof (cachedProfile as any)?.displayName === 'string' ? (cachedProfile as any).displayName : null;

        if (cachedProfile && cachedDisplayName) {
          setProfile(cachedProfile as UserProfile);
          return;
        }
      } catch {
        // ignore and fall back to DB
      }

      // DB fallback: source of truth.
      try {
        const { fetchFarmers } = await import('../api/client');
        const farmers = await fetchFarmers();
        const me = farmers.find((f) => f.VENDOR_ID === vn);
        if (me) {
          const offers = (me.PRODUCE_GIVING || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({ id: `offer-${vn}-${name}`, name, photos: [] }));
          const wants = (me.PRODUCE_WANTED || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          const p: UserProfile = {
            vendorNumber: vn,
            displayName: typeof me.Name === 'string' && me.Name.trim().length ? me.Name : `Farmer ${vn}`,
            offers,
            wants,
          };

          setProfile(p);
          await storageSetJSON(KEYS.profileByVendor(vn), p);
          return;
        }
      } catch {
        // fall back to a minimal profile
      }

      setProfile({
        vendorNumber: vn,
        displayName: `Farmer ${vn}`,
        offers: [],
        wants: [],
      });
    })();
  }, []);



  const offers = useMemo(() => myProfile?.offers?.map((o) => o.name).filter(Boolean) ?? [], [myProfile]);
  const wants = useMemo(() => myProfile?.wants ?? [], [myProfile]);


  async function persistLocal(next: UserProfile) {
    if (!vendorNumber) return;
    setProfile(next);
    await storageSetJSON(KEYS.profileByVendor(vendorNumber), next);
  }


  async function handleSaveListing() {
    if (!vendorNumber || !myProfile) return;



    const uniqueOffers: string[] = Array.from(
      new Set(offers.map((x) => x.trim()).filter((x): x is string => Boolean(x)))
    );
    const uniqueWants: string[] = Array.from(
      new Set(wants.map((x) => x.trim()).filter((x): x is string => Boolean(x)))
    );


    try {
      // Backend schema has single-string columns; we store multiple items as CSV.
      await upsertFarmerByID(vendorNumber, {
        Name: myProfile.displayName,

        PRODUCE_GIVING: toCSV(uniqueOffers),
        PRODUCE_WANTED: toCSV(uniqueWants),
        LATITUDE: 0,
        LONGITUDE: 0,
      });

      Alert.alert('Saved', 'Your listing has been updated.');
    } catch {
      Alert.alert('Error', 'Failed to save listing.');
    }
  }

  function toggleOffer(name: string) {
    if (!myProfile) return;
    const exists = offers.includes(name);
    if (exists) {
      persistLocal({ ...myProfile, offers: myProfile.offers.filter((o) => o.name !== name) });
    } else {
      const nextOffers = [...myProfile.offers, { id: id(), name, photos: [] }];
      persistLocal({ ...myProfile, offers: nextOffers });
    }
  }

  function toggleWant(name: string) {
    if (!myProfile) return;
    const exists = wants.includes(name);
    let nextWants: string[] = [];
    if (exists) {
      nextWants = wants.filter((x) => x !== name);
    } else {
      nextWants = [...wants, name];
    }
    persistLocal({ ...myProfile, wants: nextWants });
  }



  if (!myProfile) {
    return (
      <View style={styles.container}>
        <Text>Loading profile...</Text>
      </View>
    );
  }


  return (
<ImageBackground source={profileBg} style={{ flex: 1 }} imageStyle={{ opacity: 0.85 }}>
      <View style={styles.profileOverlay} />
<ScrollView contentContainerStyle={styles.container} style={{ flex: 1 }}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: '#1f2937', marginBottom: 4 }}>
        {myProfile?.displayName || 'Loading Profile...'}
      </Text>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.muted}>Vendor: {myProfile.vendorNumber}</Text>

      <View style={{ marginBottom: 8 }}>
        <Button
          title="Switch Account"
          onPress={async () => {
            const currentVendor = myProfile?.vendorNumber;
            try {
              await (async () => {
                const { storageSetString } = await import('../storage/storage');
                return storageSetString(KEYS.vendorNumber, '');
              })();
              if (currentVendor) await storageSetJSON(KEYS.profileByVendor(currentVendor), null);
              await storageSetJSON(KEYS.trades, []);
              await storageSetJSON(KEYS.reputation, {});
            } catch {}
            onSignOut();
          }}
        />
      </View>

      <View style={styles.pinnedWrap}>
        <Text style={styles.pinnedTitle}>My Listing</Text>
        <Text style={styles.pinnedText}>Offers: {offers.length ? offers.join(', ') : '—'}</Text>
        <Text style={styles.pinnedText}>Wants: {wants.length ? wants.join(', ') : '—'}</Text>
        <TouchableOpacity style={[styles.saveBtn, { marginTop: 10 }]} onPress={handleSaveListing}>
          <Text style={styles.saveBtnText}>Save Listing</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Offers (what you give)</Text>
      <ImageBackground source={offerBg} style={styles.chipsBg} imageStyle={{ borderRadius: 12, opacity: 0.22 }}>
        <View style={styles.chipsGrid}>
          {PRESET_CROPS.map((crop) => {
            const active = offers.includes(crop.label);
            return (
              <TouchableOpacity
                key={crop.label}
                onPress={() => toggleOffer(crop.label)}
                style={[
                  styles.chip,
                  active ? styles.chipOfferActive : styles.chipInactive,
                ]}
              >
                <Text style={[styles.chipText, active ? styles.chipOfferTextActive : styles.chipTextInactive]}>
                  {crop.emoji} {crop.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ImageBackground>

      <Text style={styles.sectionTitle}>Wants (what you accept)</Text>
      <ImageBackground source={wantBg} style={styles.chipsBg} imageStyle={{ borderRadius: 12, opacity: 0.22 }}>
        <View style={styles.chipsGrid}>
          {PRESET_CROPS.map((crop) => {
            const active = wants.includes(crop.label);
            return (
              <TouchableOpacity
                key={crop.label}
                onPress={() => toggleWant(crop.label)}
                style={[styles.chip, active ? styles.chipWantActive : styles.chipInactive]}
              >
                <Text style={[styles.chipText, active ? styles.chipWantTextActive : styles.chipTextInactive]}>
                  {crop.emoji} {crop.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ImageBackground>
    </ScrollView>
  </ImageBackground>
);
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: 'transparent', gap: 14 },
  profileOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  title: { fontSize: 26, fontWeight: '800', color: theme.colors.text },
  muted: { color: theme.colors.muted, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  pinnedWrap: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, gap: 6 },
  pinnedTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  pinnedText: { color: theme.colors.text, fontWeight: '700' },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  chipInactive: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
  },
  chipOfferActive: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
  },
  chipWantActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6',
  },
  chipText: {
    fontWeight: '800',
  },
  chipTextInactive: {
    color: '#6b7280',
  },
  chipOfferTextActive: {
    color: '#15803d',
  },
  chipWantTextActive: {
    color: '#1d4ed8',
  },
  saveBtn: { backgroundColor: theme.colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  chipsBg: { borderRadius: 12, padding: 12, overflow: 'hidden' },
  saveBtnText: { color: '#fff', fontWeight: '900' },

});


