import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * 画面の並び。
 *
 * いまは「Web 画面を表示する外枠」と「別ウィンドウ」の 2 つだけ。
 * ネイティブの画面へ置き換えるときは、このフォルダに画面のファイルを足していく
 * (例: src/app/register.tsx を作ると /register がネイティブのレジになる)。
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="window"
          options={{ presentation: "fullScreenModal", headerShown: true, title: "wearPOS" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
