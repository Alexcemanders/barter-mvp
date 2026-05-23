import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import type { NavigationContainerProps } from '@react-navigation/native';


import BottomTabs from './BottomTabs';
import TradeDetailScreen from '../screens/TradeDetailScreen';
import ProposeTradeScreen from '../screens/ProposeTradeScreen';

export type RootStackParamList = {
  Tabs: undefined;
  TradeDetail: { tradeId: string };
  ProposeTrade: {
    offeredKey: string;
    wantedKey: string;
    senderNote: string;
    sender_id: string;
    receiver_id: string;
    meeting_name?: string;
    meeting_lat?: number;
    meeting_lng?: number;
  };
};



const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator({ onSignOut }: { onSignOut: () => void }) {
  return (
    <NavigationContainer {...({} as NavigationContainerProps)}>
      <Stack.Navigator
        // Some versions of react-navigation types require an `id` prop.
        // This does not affect runtime behavior.
        id="root-stack"
      >
        <Stack.Screen
          name="Tabs"
          options={{ headerShown: false }}
          children={() => <BottomTabs onSignOut={onSignOut} />}
        />
        <Stack.Screen name="TradeDetail" component={TradeDetailScreen} options={{ title: 'Trade' }} />
        <Stack.Screen
          name="ProposeTrade"
          component={ProposeTradeScreen}
          options={{ presentation: 'modal', title: 'Propose Trade' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}















