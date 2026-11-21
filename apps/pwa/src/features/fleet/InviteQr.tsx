import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../../shared/ui/index.ts";

/** AI-P6-2: the invite as a QR code (black on white — scanners need contrast). */
export function InviteQr({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    import("qrcode-generator")
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, "M");
        qr.addData(text);
        qr.make();
        if (live) setSrc(qr.createDataURL(6, 4));
      })
      .catch(() => {
        // Offline oder neue App-Version mit anderem Chunk-Namen: sichtbar melden,
        // der Code zum Eintippen steht daneben.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [text]);
  if (failed) return <div class="reply-error">{t("fleet.qr_failed")}</div>;
  return src ? <img class="fleet-qr" src={src} alt={t("fleet.qr_invitation")} /> : null;
}

/**
 * AI-P6-2: camera scanner for the invite QR. Decodes frames with jsQR
 * (works where BarcodeDetector does not, e.g. iOS Safari). Stops the
 * camera as soon as a code is read or the dialog closes.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Kamera nicht verfügbar — die App braucht HTTPS. Adresse und Code bitte eintippen.");
        return;
      }
      const [{ default: jsQR }, media] = await Promise.all([
        import("jsqr"),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }),
      ]);
      stream = media;
      if (stopped || !video.current || !ctx) return;
      video.current.srcObject = media;
      await video.current.play();
      const tick = () => {
        if (stopped) return;
        const v = video.current;
        if (v && v.videoWidth > 0) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          if (found?.data) {
            onResult(found.data);
            return;
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })().catch((err: unknown) => {
      if (!stopped) setError(err instanceof Error && err.name === "NotAllowedError" ? "Kamera nicht erlaubt." : "Kamera konnte nicht starten.");
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div class="fleet-scanner">
      {error ? <div class="reply-error">{error}</div> : <video ref={video} class="fleet-scanner-video" muted playsInline />}
      <Button onClick={onClose}>
        {t("fleet.cancel_scan")}
      </Button>
    </div>
  );
}
