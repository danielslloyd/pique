export interface HypWord {
  word: string;
  confidence: number;
}

export type RecognitionStatus = "idle" | "listening" | "paused" | "restarting" | "error" | "unsupported";

export interface RecognitionCallbacks {
  /** Called with every hypothesis (all alternatives flattened into words). */
  onHypothesis: (words: HypWord[], isFinal: boolean) => void;
  onStatus: (status: RecognitionStatus, detail?: string) => void;
}

export interface RecognitionProvider {
  readonly name: string;
  isSupported(): boolean;
  start(callbacks: RecognitionCallbacks): void;
  /** Mute during app audio playback so we never recognize our own TTS. */
  pause(): void;
  resume(): void;
  stop(): void;
}
