import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { WebShell } from "../components/WebShell";
import { APP_URL } from "../lib/config";
import { decideNavigation } from "../lib/navigation";

/**
 * Web 側が別ウィンドウとして開く画面 (レジ・レシート) を、アプリ内で重ねて表示する。
 * Web 側の「閉じる」(window.close) でも、左上の「閉じる」でも戻れる。
 */
export default function WindowScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const url = Array.isArray(params.url) ? params.url[0] : params.url;

  // この画面はリンク (wearpos://window?url=...) からも開ける。
  // 自分のサーバー以外の URL を渡されても、アプリ内では開かない
  const allowed = typeof url === "string" && decideNavigation(url, APP_URL) === "inside";

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!allowed) close();
  }, [allowed, close]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={close} accessibilityRole="button" hitSlop={12}>
              <Text style={styles.close}>閉じる</Text>
            </Pressable>
          ),
        }}
      />
      {allowed && <WebShell url={url} popup onClose={close} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  close: { fontSize: 16, color: "#16161c", fontWeight: "600" },
});
