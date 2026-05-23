declare module 'expo-location' {
  export type LocationAccuracy = any;

  export const Accuracy: {
    High: any;
  };

  export function requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  export function getCurrentPositionAsync(options?: { accuracy?: any }): Promise<{
    coords: { latitude: number; longitude: number };
  }>;
}

