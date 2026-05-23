import React, { useMemo, useState } from 'react';
import { ImageBackground } from 'react-native';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OfferItem, UserProfile } from '../models/types';
import { KEYS, storageGetJSON, storageSetString, storageSetJSON } from '../storage/storage';

import { theme } from '../theme';

function csvToTrimmedStrings(csv: string): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildProfileFromFarmerDTO(vendorNumber: string, farmer: { Name: string; PRODUCE_GIVING: string; PRODUCE_WANTED: string }): UserProfile {
  const offersCsv = csvToTrimmedStrings(farmer.PRODUCE_GIVING);
  const wants = csvToTrimmedStrings(farmer.PRODUCE_WANTED);

  const offers: OfferItem[] = offersCsv.map((name) => ({
    id: `offer-${vendorNumber}-${name}`,
    name,
    photos: [],
  }));

  // MVP: coordinates are optional; default to 0 until set by MapScreen.
  return {
    vendorNumber,
    displayName: farmer.Name || `Farmer ${vendorNumber}`,
    offers,
    wants,
    latitude: 0,
    longitude: 0,
  };
}

export default function OnboardingScreen({ onDone }: { onDone: (profile: UserProfile) => void }) {


  const [vendorNumber, setVendorNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const normalized = useMemo(() => vendorNumber.trim(), [vendorNumber]);

  async function handleContinue() {
    if (loading) return;
    const vn = normalized;
    if (!vn) {
      Alert.alert('Vendor number required', 'Enter your vendor number.');
      return;
    }

    setLoading(true);

    // DB is source of truth. AsyncStorage is only a cache.
    try {
      const resolvedName = displayName.trim() ? displayName.trim() : `Farmer ${vn}`;

      const { fetchFarmers, createFarmer } = await import('../api/client');
      const farmers = await fetchFarmers();
      const existingFarmer = farmers.find((f) => f.VENDOR_ID === vn);

      if (existingFarmer) {
        const profile = buildProfileFromFarmerDTO(vn, existingFarmer);
        // Cache locally.
        await storageSetString(KEYS.vendorNumber, vn);
        await storageSetJSON(KEYS.profileByVendor(vn), profile);
        onDone(profile);
        return;


      }

      // Not found: create first.
      await createFarmer({
        VENDOR_ID: vn,
        Name: resolvedName,
        PRODUCE_GIVING: '',
        PRODUCE_WANTED: '',
        LATITUDE: 0,
        LONGITUDE: 0,
      });

      // Re-fetch to ensure backend remains source of truth.
      const farmersAfter = await fetchFarmers();
      const createdFarmer = farmersAfter.find((f) => f.VENDOR_ID === vn);

      const profile = createdFarmer
        ? buildProfileFromFarmerDTO(vn, createdFarmer)
        : {
            vendorNumber: vn,
            displayName: resolvedName,
            offers: [],
            wants: [],
          };

      await storageSetString(KEYS.vendorNumber, vn);
      await storageSetJSON(KEYS.profileByVendor(vn), profile);
      onDone(profile);
    } catch (e) {
      // Improve debugging + reduce false negatives (backend may have stored the farmer but
      // the request/response could have timed out on the client).
      // eslint-disable-next-line no-console
      console.error('Onboarding continue failed:', e);

      try {
        const { fetchFarmers } = await import('../api/client');
        const farmers = await fetchFarmers();
        const existingFarmer = farmers.find((f) => f.VENDOR_ID === vn);

        if (existingFarmer) {
          const profile = buildProfileFromFarmerDTO(vn, existingFarmer);
          await storageSetString(KEYS.vendorNumber, vn);
          await storageSetJSON(KEYS.profileByVendor(vn), profile);
          onDone(profile);
          return;
        }


      } catch {
        // Ignore re-fetch errors; we'll fall back to the user-facing message.
      }

      Alert.alert('Error', 'Failed to connect to server.');
      return;
    } finally {
      setLoading(false);
    }

    // 2) Split-local-setup fallback (keeps local UI consistent if storage fails).
    // Note: per fix #2 we only proceed to onDone from the API success paths above.
  }

  return (
    <ImageBackground source={onboardingBg} style={styles.container} imageStyle={{ opacity: 0.85 }}>
      <View style={styles.innerWrap}>


      <Text style={styles.title}>Barter Farmers</Text>
      <Text style={styles.subtitle}>Enter your vendor number to get started.</Text>

      <TextInput
        style={styles.input}
        placeholder="Vendor number (e.g., VN-1001)"
        value={vendorNumber}
        onChangeText={setVendorNumber}
      />

      <TextInput
        style={styles.input}
        placeholder="Display name (optional)"
        value={displayName}
        onChangeText={setDisplayName}
      />

      <Button title={loading ? 'Loading...' : 'Continue'} onPress={handleContinue} disabled={loading} />
      </View>
    </ImageBackground>
  );
}

const onboardingBg = require('../../assets/images/foronboarding.jpg');

const styles = StyleSheet.create({
  innerWrap: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 18,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: 20,
    justifyContent: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 6, color: theme.colors.text },
  subtitle: { color: theme.colors.muted, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
});


