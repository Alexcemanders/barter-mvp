import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { theme } from '../theme';
import BarterScreen from '../screens/BarterScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MapScreen from '../screens/MapScreen';

// 1. Import the global notification hook to drive the badge visibility
import { useTradeNotifications } from '../hooks/useTradeNotifications';

export type RootTabParamList = {
  Barter: undefined;
  Profile: undefined;
  Map: undefined;
  TradeDetail: {
    tradeId: string;
  };
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function BottomTabs({ onSignOut }: { onSignOut: () => void }) {
  // 2. Consume the global trade notification flag
  const { hasNewIncoming, hasNewOutgoingAccepted } = useTradeNotifications();


  return (
    <Tab.Navigator
      id="root-tabs"
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
      }}
    >
      <Tab.Screen 
        name="Barter" 
        component={BarterScreen} 
        options={{ 
          tabBarLabel: 'Basket Barter',
          // 3. Instead of broken string emojis, use a custom component icon layout
          tabBarIcon: ({ color, size }) => (
            <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: size - 4 }}>🛒</Text>
              {/* 4. Render a completely custom badge dot if there's a new notification */}
              {(hasNewIncoming || hasNewOutgoingAccepted) && (
                <View style={styles.notificationDot} />
              )}

            </View>
          )
        }} 
      />
      
      <Tab.Screen
        name="Profile"
        options={{ 
          tabBarLabel: 'User Profile',
          tabBarIcon: ({ size }) => <Text style={{ fontSize: size - 4 }}>🧑‍🌾</Text>
        }}
        children={() => <ProfileScreen onSignOut={onSignOut} />}
      />
      
      <Tab.Screen 
        name="Map" 
        component={MapScreen} 
        options={{ 
          tabBarLabel: 'Map',
          tabBarIcon: ({ size }) => <Text style={{ fontSize: size - 4 }}>🗺️</Text>
        }} 
      />
    </Tab.Navigator>
  );
}

// 5. Clean styles for your custom global notification badge
const styles = StyleSheet.create({
  notificationDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#ef4444', // Vibrant notification red
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#fff', // White ring to pop out against the background
  },
});