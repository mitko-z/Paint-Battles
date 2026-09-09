import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { OrientationGate } from "@/components/OrientationGate";
import { colors } from "@/lib/theme";

// Battle Poster direction's two typefaces (SIL OFL / Apache-licensed, bundled locally rather
// than pulled from Google Fonts at runtime - see assets/fonts/). The keys below are the
// fontFamily strings used everywhere in theme.ts / components.
const fontAssets = {
  PermanentMarker: require("../assets/fonts/PermanentMarker-Regular.ttf"),
  "BarlowCondensed-Medium": require("../assets/fonts/BarlowCondensed-Medium.ttf"),
  "BarlowCondensed-SemiBold": require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
  "BarlowCondensed-Bold": require("../assets/fonts/BarlowCondensed-Bold.ttf"),
};

export default function RootLayout() {
  // Renders nothing for the one tick these local TTFs take to register rather than
  // flashing system-font text - fontError still falls through to render (system font
  // fallback) instead of stranding the app if a file is ever missing/corrupt.
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ink }}>
      <AuthProvider>
        <StatusBar style="light" />
        <OrientationGate>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink } }} />
        </OrientationGate>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
