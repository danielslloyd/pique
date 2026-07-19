// Whisper recognition provider. Streams mic audio to the backend ASR WebSocket as
// Int16 16kHz mono PCM. The server re-transcribes a ~6s rolling window every ~1s and
// returns a FULL fresh hypothesis each time (not a delta) — we forward those to the
// pile-based MatchController, which scans forward from its last match and so tolerates
// repeated full re-transcriptions. isFinal=true on every partial keeps the stuck
// counter honest.
//
// Mic capture uses an AudioWorklet (loaded from an inline blob URL) that posts raw
// Float32 chunks to the main thread; we downsample context.sampleRate -> 16000 with
// linear interpolation, convert to Int16, and send ~4096-sample binary frames. A hard
// pause() flag plus AudioContext.suspend() guarantees we never capture app audio.

import type { HypWord, RecognitionCallbacks, RecognitionProvider } from "./types";

const WS_URL = "ws://localhost:8010/ws/asr";
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 4096;
const RESUME_DELAY_MS = 300;

// Inline AudioWorklet: buffers input to ~2048 samples, then posts a Float32 copy.
const WORKLET_SOURCE = `
class PiquePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n >= this._buf.length) {
          this.port.postMessage(this._buf.slice(0));
          this._n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pique-pcm', PiquePCM);
`;

interface WhisperPartial {
  type: "partial";
  words?: { word: string; confidence?: number }[];
  text?: string;
}

interface WhisperReady {
  type: "ready";
}

type WhisperMessage = WhisperReady | WhisperPartial | { type: string };

export class WhisperProvider implements RecognitionProvider {
  readonly name = "whisper";

  private callbacks: RecognitionCallbacks | null = null;
  private active = false;
  private paused = false;

  private ws: WebSocket | null = null;
  private wsReady = false; // server sent "ready"
  private micReady = false; // mic + audio graph live
  private announcedListening = false;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private inputRate = TARGET_RATE;

  // Resampler state (main thread).
  private pending = new Float32Array(0);
  private resampleOffset = 0;
  private i16: number[] = [];

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private expectedText: string) {}

  isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioContext !== "undefined" &&
      typeof WebSocket !== "undefined"
    );
  }

  start(callbacks: RecognitionCallbacks): void {
    this.callbacks = callbacks;
    if (!this.isSupported()) {
      callbacks.onStatus("unsupported", "This browser can't capture audio for Whisper.");
      return;
    }
    this.active = true;
    this.paused = false;
    this.announcedListening = false;
    this.openSocket();
    void this.openMic();
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    void this.ctx?.suspend().catch(() => {});
    this.callbacks?.onStatus("paused");
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    // Delay so the tail of app audio isn't captured.
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (!this.active || !this.paused) return;
      // Drop any audio buffered before/around the pause.
      this.pending = new Float32Array(0);
      this.resampleOffset = 0;
      this.i16 = [];
      this.paused = false;
      void this.ctx?.resume().catch(() => {});
      if (this.micReady && this.wsReady) this.callbacks?.onStatus("listening");
    }, RESUME_DELAY_MS);
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    // Politely end the ASR session.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* ignore */
      }
    }
    this.teardownSocket();
    this.teardownAudio();
    this.callbacks?.onStatus("idle");
    this.callbacks = null;
  }

  // --- WebSocket --------------------------------------------------------------
  private openSocket(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      this.fail(`Couldn't open the recognition connection: ${String(e)}`);
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (!this.active) return;
      try {
        ws.send(JSON.stringify({ type: "start", expected_text: this.expectedText }));
      } catch (e) {
        this.fail(`Couldn't start the recognition session: ${String(e)}`);
      }
    };

    ws.onmessage = (event) => {
      if (!this.active || typeof event.data !== "string") return;
      let msg: WhisperMessage;
      try {
        msg = JSON.parse(event.data) as WhisperMessage;
      } catch {
        return;
      }
      if (msg.type === "ready") {
        this.wsReady = true;
        this.maybeAnnounceListening();
      } else if (msg.type === "partial") {
        const partial = msg as WhisperPartial;
        const words: HypWord[] = (partial.words ?? []).map((w) => ({
          word: w.word,
          confidence: typeof w.confidence === "number" ? w.confidence : 0.5,
        }));
        if (words.length > 0) this.callbacks?.onHypothesis(words, true);
      } else if (msg.type === "error") {
        this.fail("The recognition service reported an error.");
      }
    };

    ws.onerror = () => {
      if (this.active) this.fail("Lost the connection to the recognition service.");
    };

    ws.onclose = () => {
      if (this.active) this.fail("The recognition connection closed unexpectedly.");
    };
  }

  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.wsReady = false;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  // --- Mic + audio graph ------------------------------------------------------
  private async openMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: TARGET_RATE },
          channelCount: 1,
          echoCancellation: true,
        },
      });
      if (!this.active) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;

      const ctx = new AudioContext();
      this.ctx = ctx;
      this.inputRate = ctx.sampleRate;

      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!this.active) {
        this.teardownAudio();
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pique-pcm");
      // Silent sink keeps the graph "pulled" so the worklet runs, without echoing to speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.port.onmessage = (e: MessageEvent) => this.handleChunk(e.data as Float32Array);
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      this.source = source;
      this.node = node;
      this.sink = sink;

      this.micReady = true;
      this.maybeAnnounceListening();
    } catch (e) {
      this.fail(`Couldn't use the microphone: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private teardownAudio(): void {
    this.micReady = false;
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        /* ignore */
      }
      this.node = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.sink) {
      try {
        this.sink.disconnect();
      } catch {
        /* ignore */
      }
      this.sink = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.pending = new Float32Array(0);
    this.resampleOffset = 0;
    this.i16 = [];
  }

  // --- Resample + send --------------------------------------------------------
  private handleChunk(chunk: Float32Array): void {
    if (!this.active || this.paused || !this.wsReady || !this.ws) return;

    // Append to the carry buffer.
    const combined = new Float32Array(this.pending.length + chunk.length);
    combined.set(this.pending, 0);
    combined.set(chunk, this.pending.length);

    const ratio = this.inputRate / TARGET_RATE;
    let pos = this.resampleOffset;
    while (pos + 1 < combined.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const sample = combined[i0] * (1 - frac) + combined[i0 + 1] * frac;
      const s = sample < 0 ? Math.max(-1, sample) : Math.min(1, sample);
      this.i16.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      pos += ratio;
    }
    const consumed = Math.floor(pos);
    this.pending = combined.slice(consumed);
    this.resampleOffset = pos - consumed;

    while (this.i16.length >= FRAME_SAMPLES) {
      const frame = this.i16.splice(0, FRAME_SAMPLES);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(Int16Array.from(frame).buffer);
      }
    }
  }

  // --- helpers ----------------------------------------------------------------
  private maybeAnnounceListening(): void {
    if (this.announcedListening) return;
    if (this.micReady && this.wsReady && !this.paused) {
      this.announcedListening = true;
      this.callbacks?.onStatus("listening");
    }
  }

  private fail(detail: string): void {
    if (!this.active) return;
    this.callbacks?.onStatus("error", detail);
  }
}
