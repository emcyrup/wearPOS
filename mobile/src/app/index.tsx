import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { WebShell } from "../components/WebShell";
import { APP_URL } from "../lib/config";
import { appPath } from "../lib/navigation";

/** 起動して最初に出る画面。今の Web アプリのトップ (未ログインならログイン画面) を表示する */
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <WebShell url={appPath("/", APP_URL)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
});
