import { t } from "./i18n/index.ts";
import { STT_STREAM_MAX_BUFFERED_BYTES, type SttStreamEvent } from "@ancientvoid/contracts";
import { hubApi } from "./api.ts";

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 320; // 20 ms at 16 kHz

export interface StreamTranscript {
  text: string;
  engine: string;
  serverMs: number;
}

export class LocalSttStream {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private socket: WebSocket | null = null;
  private samples: number[] = [];
  private partial = "";
  private startedAt = 0;
  private closed = false;
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private resultResolve: ((value: StreamTranscript) => void) | null = null;
  private resultReject: ((error: Error) => void) | null = null;
  private readyPromise: Promise<void>;
  private resultPromise: Promise<StreamTranscript>;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onPartial: (text: string) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.resultPromise = new Promise((resolve, reject) => {
      this.resultResolve = resolve;
      this.resultReject = reject;
    });
    // Stop/cancel can reject before the caller asks for a transcript.
    void this.readyPromise.catch(() => undefined);
    void this.resultPromise.catch(() => undefined);
  }

  async start(stream: MediaStream): Promise<void> {
    this.startedAt = performance.now();
    try {
      if (typeof AudioWorkletNode === "undefined" || typeof WebSocket === "undefined") throw new Error(t("stt.no_stream_device"));
      this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
      if (this.context.sampleRate !== SAMPLE_RATE) throw new Error(t("stt.no_16k"));
      await this.context.audioWorklet.addModule("/pcm-capture.worklet.js");
      this.source = this.context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(this.context, "ancientvoid-pcm16-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.acceptSamples(new Int16Array(event.data));
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);

      const { ticket } = await hubApi.sttStreamTicket();
      this.socket = new WebSocket(hubApi.sttStreamUrl(ticket));
      this.socket.binaryType = "arraybuffer";
      this.socket.onmessage = (event) => this.receive(event.data);
      this.socket.onerror = () => this.fail(t("stt.live_unreachable_check"));
      this.socket.onclose = () => {
        if (!this.closed) this.fail(t("stt.live_dropped_check"));
      };
      this.readyTimer = setTimeout(() => this.fail(t("stt.live_no_start_check")), 8_000);
      await this.readyPromise;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("stt.live_no_start");
      this.fail(message);
      throw error;
    }
  }

  async finish(): Promise<StreamTranscript> {
    await this.readyPromise;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error(t("stt.live_dropped"));
    this.flush(true);
    this.socket.send(JSON.stringify({ type: "finish" }));
    this.processor?.disconnect();
    this.source?.disconnect();
    await this.context?.close().catch(() => undefined);
    this.processor = null;
    this.source = null;
    this.context = null;
    return this.resultPromise;
  }

  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "cancel" }));
    this.socket?.close();
    this.cleanupAudio();
    const cancelled = new Error(t("stt.rec_cancelled"));
    this.readyReject?.(cancelled);
    this.resultReject?.(cancelled);
  }

  private acceptSamples(pcm: Int16Array): void {
    if (this.closed) return;
    for (const sample of pcm) this.samples.push(sample);
    if (this.samples.length * 2 > STT_STREAM_MAX_BUFFERED_BYTES) {
      this.fail(t("stt.backpressure"));
      return;
    }
    this.flush(false);
  }

  private flush(includeRemainder: boolean): void {
    const socket = this.socket;
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    while (this.samples.length >= FRAME_SAMPLES || (includeRemainder && this.samples.length > 0)) {
      if (socket.bufferedAmount > STT_STREAM_MAX_BUFFERED_BYTES) {
        this.fail(t("stt.overloaded"));
        return;
      }
      const count = includeRemainder ? Math.min(FRAME_SAMPLES, this.samples.length) : FRAME_SAMPLES;
      const frame = new Int16Array(count);
      for (let i = 0; i < count; i += 1) frame[i] = this.samples[i] ?? 0;
      this.samples.splice(0, count);
      socket.send(frame.buffer);
    }
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "string") return this.fail(t("stt.bad_answer"));
    let event: SttStreamEvent;
    try {
      event = JSON.parse(raw) as SttStreamEvent;
    } catch {
      return this.fail(t("stt.bad_answer"));
    }
    if (event.type === "ready") {
      this.ready = true;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.readyResolve?.();
      this.flush(false);
    } else if (event.type === "partial") {
      this.partial += event.text;
      this.onPartial(this.partial.trimStart());
    } else if (event.type === "final") {
      this.closed = true;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.resultResolve?.({ text: event.text, engine: event.engine, serverMs: Math.round(performance.now() - this.startedAt) });
      this.socket?.close();
      this.cleanupAudio();
    } else {
      this.fail(event.message);
    }
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.onError(message);
    const error = new Error(message);
    this.readyReject?.(error);
    this.resultReject?.(error);
    this.socket?.close();
    this.cleanupAudio();
  }

  private cleanupAudio(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
