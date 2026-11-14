import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";

import { buildInjectedScript, parseBridgeMessage } from "../lib/bridge";
import { APP_URL, APP_VERSION } from "../lib/config";
import { decideNavigation } from "../lib/navigation";
import { printHtml } from "../lib/print";

type Props = {
  /** 最初に開く URL (アプリのサーバー上のもの) */
  url: string;
  /** 別ウィンドウとして開いた画面なら true。window.close() で onClose が呼ばれる */
  popup?: boolean;
  onClose?: () => void;
};

type Failure = { title: string; detail: string };

// react-native-webview の型は追加 props の既定値が undefined で、そのままだと
// props 全体が never になる。追加 props なしを明示する
type NoExtraProps = Record<never, never>;
type AppWebView = WebView<NoExtraProps>;

/**
 * Web 画面を表示する共通の外枠。
 *
 * 画面そのものは今の Web アプリをそのまま使い、ブラウザと違う部分だけをここで補う。
 *   - 別ウィンドウ (window.open) → アプリ内の画面として重ねて開く
 *   - 印刷 (window.print)        → OS の印刷機能へ渡す
 *   - 外部サイトへのリンク        → 端末のブラウザや LINE アプリで開く
 *   - つながらないとき            → 再読み込みできる案内を出す
 */
export function WebShell({ url, popup = false, onClose }: Props) {
  const router = useRouter();
  const webview = useRef<AppWebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);

  const injected = useMemo(
    () => buildInjectedScript({ popup, appVersion: APP_VERSION }),
    [popup],
  );

  // Android の戻るボタン: Web 画面の履歴があれば 1 つ戻り、無ければ通常の動き (画面を閉じる)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webview.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const openOutside = useCallback((target: string) => {
    Linking.openURL(target).catch(() => {
      // 対応するアプリが無いなど。画面はそのままにする
    });
  }, []);

  const onShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest) => {
      // iframe の中の読み込みは画面遷移ではないので止めない
      if (request.isTopFrame === false) return true;
      const decision = decideNavigation(request.url, APP_URL);
      if (decision === "inside") return true;
      if (decision === "external") openOutside(request.url);
      return false;
    },
    [openOutside],
  );

  /** 別ウィンドウを開く依頼。自分のサーバーの画面ならアプリ内で重ねて開く */
  const openWindow = useCallback(
    (target: string) => {
      const decision = decideNavigation(target, APP_URL);
      if (decision === "inside") {
        router.push({ pathname: "/window", params: { url: target } });
      } else if (decision === "external") {
        openOutside(target);
      }
    },
    [openOutside, router],
  );

  // target="_blank" のリンクから。window.open() は橋のメッセージ (下の onMessage) で届く
  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => openWindow(event.nativeEvent.targetUrl),
    [openWindow],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // 橋を呼べるのは自分のサーバーのページだけにする
      if (decideNavigation(event.nativeEvent.url, APP_URL) !== "inside") return;
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) return;
      if (message.type === "print") void printHtml(message.html, message.baseUrl);
      if (message.type === "open") openWindow(message.url);
      if (message.type === "close") onClose?.();
    },
    [onClose, openWindow],
  );

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
  }, []);

  const reload = useCallback(() => {
    setFailure(null);
    setLoading(true);
    webview.current?.reload();
  }, []);

  return (
    <View style={styles.container}>
      <WebView<NoExtraProps>
        ref={webview}
        source={{ uri: url }}
        applicationNameForUserAgent={`wearPOS-App/${APP_VERSION}`}
        injectedJavaScriptBeforeContentLoaded={injected}
        // 読み込み前の差し込みが間に合わなかった場合の保険 (スクリプト側で二重実行を防いでいる)
        injectedJavaScript={injected}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onOpenWindow={onOpenWindow}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(event) =>
          setFailure({
            title: "サーバーにつながりません",
            detail: event.nativeEvent.description || "通信状況を確認してください",
          })
        }
        onHttpError={(event) => {
          // サーバー停止中 (502/503/504) だけ案内に切り替える。404 などは Web 側の画面に任せる
          const status = event.nativeEvent.statusCode;
          if (status >= 502 && status <= 504) {
            setFailure({
              title: "サーバーが応答していません",
              detail: `しばらくしてから再読み込みしてください (${status})`,
            });
          }
        }}
        // ログイン状態とレジ端末の認可 (Cookie) を、重ねて開いた画面とも共有する
        sharedCookiesEnabled
        domStorageEnabled
        // バーコード読み取り (カメラ) を Web 画面の中で使えるようにする
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsBackForwardNavigationGestures
        // メモリ不足などで描画プロセスが落ちたら、白い画面のままにせず読み込み直す
        onContentProcessDidTerminate={() => webview.current?.reload()}
        onRenderProcessGone={() => webview.current?.reload()}
        style={styles.webview}
      />

      {loading && !failure && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color="#16161c" />
        </View>
      )}

      {failure && (
        <View style={styles.failure}>
          <Text style={styles.failureTitle}>{failure.title}</Text>
          <Text style={styles.failureDetail}>{failure.detail}</Text>
          <Pressable style={styles.retry} onPress={reload} accessibilityRole="button">
            <Text style={styles.retryLabel}>再読み込み</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  webview: { flex: 1, backgroundColor: "#ffffff" },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  failure: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  failureTitle: { fontSize: 18, fontWeight: "700", color: "#16161c", textAlign: "center" },
  failureDetail: { marginTop: 8, fontSize: 14, color: "#4b4b57", textAlign: "center" },
  retry: {
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#16161c",
  },
  retryLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
