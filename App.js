import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { KEYS, storageGetJSON, storageGetString } from './src/storage/storage';
import RootNavigator from './src/navigation/RootNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';


function coerceLiked(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return Boolean(v);
}

function normalizeTradesData(trades) {
  if (!Array.isArray(trades)) return trades;
  return trades.map((t) => {
    if (!t || typeof t !== 'object') return t;
    if (t.feedback && typeof t.feedback === 'object' && 'liked' in t.feedback) {
      return {
        ...t,
        feedback: {
          ...t.feedback,
          liked: coerceLiked(t.feedback.liked),
        },
      };
    }
    return t;
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error);
  }

  render() {
    if (this.state?.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <StatusBar style="auto" />
          <View style={styles.center}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>Check Metro logs for the exact error.</Text>
            <Text style={styles.errorText}>{String(this.state?.error?.message ?? this.state?.error)}</Text>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const vn = await storageGetString(KEYS.vendorNumber);
        if (!vn) {
          setReady(true);
          return;
        }

        // Never trust AsyncStorage as the source of truth.
        // Confirm account still exists in DB before auto-login.
        try {
          const { fetchFarmers } = await import('./src/api/client');
          const farmers = await fetchFarmers();
          const me = farmers.find((f) => f.VENDOR_ID === vn);

          if (!me) {
            // Account no longer exists -> clear local cache and show onboarding.
            const { storageSetJSON, storageSetString } = await import('./src/storage/storage');
            await storageSetString(KEYS.vendorNumber, '');
            await storageSetJSON(KEYS.profileByVendor(vn), null);
            await storageSetJSON(KEYS.trades, []);
            await storageSetJSON(KEYS.reputation, {});
            setReady(true);
            return;
          }

          const offersCsv = (me.PRODUCE_GIVING || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const wants = (me.PRODUCE_WANTED || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          const p = {
            vendorNumber: vn,
            displayName: me.Name || `Farmer ${vn}`,
            offers: offersCsv.map((name) => ({ id: `offer-${vn}-${name}`, name, photos: [] })),
            wants,
          };

          setProfile(p);
          setReady(true);
        } catch (e2) {
          // If DB/network is down, don't auto-login.
          setReady(true);
        }

      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize app:', e);
        setReady(true);
      }
    })();
  }, []);


  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {!ready ? (
          <View style={styles.container}>
            <StatusBar style="auto" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : profile ? (
          <RootNavigator
            onSignOut={() => {
              setProfile(null);
            }}
          />

        ) : (
          <OnboardingScreen
            onDone={(p) => {
              setProfile(p);
            }}
          />
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 20,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: '700',
  },
});


