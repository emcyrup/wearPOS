"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * カメラでバーコードを読み取るコンポーネント。
 *
 * ブラウザ標準の BarcodeDetector API があればそれを使い (Android Chrome / Edge)、
 * 無いブラウザ (iPhone の Chrome / Safari など) では ZXing を動的に読み込んで
 * フレーム解析にフォールバックする。どちらもカメラ利用に HTTPS が必要。
 * USB / Bluetooth 接続のバーコードリーダーはキーボード入力として動作するため、
 * このコンポーネントを使わずとも既存の入力欄でそのまま使える。
 */

type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

export function BarcodeScanner({
  onDetect,
  onClose,
  continuous = false,
  title = "バーコードを読み取る",
  hint,
}: {
  /** 読み取り成功時に呼ばれる (continuous のときは読み取るたびに呼ばれる) */
  onDetect: (code: string, format: string) => void;
  onClose: () => void;
  /**
   * カメラを開いたまま続けて読み取る。
   * 値札を1枚ずつスキャンしていくとき、そのつどカメラを開き直さずに済む
   */
  continuous?: boolean;
  title?: string;
  /** 進捗など、カメラの下に出す案内 (例: 「3 / 12 読み取り済み」) */
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  /** 連続読み取りで直前に読んだコード。同じ値札を何度も拾わないようにする */
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  // 親が再描画されるたびに onDetect の実体は変わる。
  // そのままだと読み取りのたびにカメラを開き直すことになるので、最新の関数だけを持ち替える
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  });

  /**
   * 読み取り結果を親に渡す。
   * 連続読み取りでは、同じコードが 2 秒以内にまた読めても無視する
   * (カメラの前に値札を出しっぱなしにしていると、同じものを何度も拾ってしまうため)
   */
  const handleDetected = useCallback(
    (code: string, format: string) => {
      if (continuous) {
        const now = Date.now();
        const last = lastRef.current;
        if (last && last.code === code && now - last.at < 2000) return false;
        lastRef.current = { code, at: now };
        setRecent((prev) => [code, ...prev.filter((value) => value !== code)].slice(0, 3));
      }
      onDetectRef.current(code, format);
      return true;
    },
    [continuous],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let raf = 0;
    let zxingControls: { stop(): void } | null = null;
    const Detector = getBarcodeDetector();
    // 開き直したときに前回の停止フラグが残っていると、すぐ止まってしまう
    stoppedRef.current = false;

    const cameraError = () =>
      setError(
        "カメラを起動できませんでした。ブラウザのカメラ許可を確認してください (HTTPS 接続が必要です)。",
      );

    (async () => {
      if (Detector) {
        // ブラウザ標準 API (Android Chrome / Edge など)
        const detector = new Detector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code"],
        });
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
          });
          if (stoppedRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          streamRef.current = stream;
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          await video.play();

          const scan = async () => {
            if (stoppedRef.current || !videoRef.current) return;
            try {
              const results = await detector.detect(videoRef.current);
              if (results.length > 0) {
                if (!continuous) {
                  stop();
                  handleDetected(results[0].rawValue, results[0].format);
                  return;
                }
                handleDetected(results[0].rawValue, results[0].format);
              }
            } catch {
              // フレーム未確定時は無視して次のフレームへ
            }
            raf = requestAnimationFrame(scan);
          };
          raf = requestAnimationFrame(scan);
        } catch {
          cameraError();
        }
        return;
      }

      // BarcodeDetector が無いブラウザ (iPhone の Chrome / Safari など) は ZXing で解析する。
      // 使うときだけ動的に読み込むので、通常ページの JS サイズには影響しない
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (stoppedRef.current || !videoRef.current) return;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.QR_CODE,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 150,
          delayBetweenScanSuccess: 300,
        });
        zxingControls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" }, audio: false },
          videoRef.current,
          (result) => {
            if (!result || stoppedRef.current) return;
            const format = BarcodeFormat[result.getBarcodeFormat()]?.toLowerCase() ?? "unknown";
            if (continuous) {
              handleDetected(result.getText(), format);
              return;
            }
            stoppedRef.current = true;
            zxingControls?.stop();
            handleDetected(result.getText(), format);
          },
        );
        // 起動待ちの間に閉じられていたら即停止する
        if (stoppedRef.current) zxingControls.stop();
      } catch {
        cameraError();
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      zxingControls?.stop();
      stop();
    };
  }, [continuous, handleDetected, stop]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          <button
            type="button"
            onClick={() => {
              stop();
              onClose();
            }}
            className="rounded-lg px-2 py-1 text-sm text-ink-400 hover:bg-ink-50 hover:text-ink-600"
          >
            閉じる
          </button>
        </div>

        {error ? (
          <p className="px-4 py-6 text-sm leading-relaxed text-ink-600">{error}</p>
        ) : (
          <div className="relative bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="block h-64 w-full object-cover" />
            {/* 読み取り位置のガイド枠 */}
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-lg border-2 border-white/80" />
            <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">
              枠内にバーコードを合わせてください
            </p>
          </div>
        )}

        {/* 連続読み取りでは、進捗と直前に読んだコードを出して手を止めずに続けられるようにする */}
        {!error && (hint || continuous) && (
          <div className="border-t border-ink-100 px-4 py-3">
            {hint && <p className="text-sm font-medium text-ink-800">{hint}</p>}
            {continuous && (
              <p className="mt-1 text-xs text-ink-400">
                {recent.length === 0
                  ? "続けて読み取れます。値札を順番にかざしてください"
                  : `読み取り済み: ${recent.join(" / ")}`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 入力欄の横に置く「カメラで読み取る」ボタン。読み取った値をコールバックで返す */
export function ScanButton({ onDetect }: { onDetect: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap text-ink-600 hover:bg-ink-50"
      >
        📷 読み取る
      </button>
      {open && (
        <BarcodeScanner
          onDetect={(code) => {
            setOpen(false);
            onDetect(code);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
