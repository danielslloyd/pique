import { create } from "zustand";
import type { RecognitionStatus } from "@/lib/recognition/types";

export type WordState = "pending" | "current" | "read" | "assisted";
export type ReaderMode = "read" | "listen" | "echo";

export interface FeedbackMessage {
  id: number;
  kind: "success" | "encourage" | "info" | "error";
  text: string;
}

interface ReaderState {
  mode: ReaderMode;
  pageIndex: number;
  wordStates: WordState[];
  pictureRevealed: boolean;
  recognitionStatus: RecognitionStatus;
  feedback: FeedbackMessage | null;
  /** Token index of the word currently sounding in Listen mode / read-back (-1 = none). */
  listenWordIndex: number;

  setMode: (mode: ReaderMode) => void;
  setPage: (pageIndex: number, wordCount: number) => void;
  applyProgress: (read: number[], assisted: number[], nextIndex: number) => void;
  revealPicture: () => void;
  setRecognitionStatus: (status: RecognitionStatus) => void;
  showFeedback: (kind: FeedbackMessage["kind"], text: string) => void;
  clearFeedback: () => void;
  setListenWordIndex: (index: number) => void;
  /** Echo mode: highlight the single word the app is currently reading aloud. */
  setEchoReadingWord: (tokenIndex: number) => void;
}

let feedbackId = 0;

function initialWordStates(count: number): WordState[] {
  const states = new Array<WordState>(count).fill("pending");
  if (count > 0) states[0] = "current";
  return states;
}

export const useReaderStore = create<ReaderState>((set) => ({
  mode: "read",
  pageIndex: 0,
  wordStates: [],
  pictureRevealed: false,
  recognitionStatus: "idle",
  feedback: null,
  listenWordIndex: -1,

  setMode: (mode) => set({ mode }),

  setPage: (pageIndex, wordCount) =>
    set({
      pageIndex,
      wordStates: initialWordStates(wordCount),
      pictureRevealed: false,
      listenWordIndex: -1,
    }),

  applyProgress: (read, assisted, nextIndex) =>
    set((state) => {
      const wordStates = [...state.wordStates];
      for (const i of read) wordStates[i] = "read";
      for (const i of assisted) wordStates[i] = "assisted";
      for (let i = 0; i < wordStates.length; i++) {
        if (wordStates[i] === "current") wordStates[i] = "pending";
      }
      if (nextIndex < wordStates.length) wordStates[nextIndex] = "current";
      return { wordStates };
    }),

  revealPicture: () => set({ pictureRevealed: true }),
  setRecognitionStatus: (recognitionStatus) => set({ recognitionStatus }),
  showFeedback: (kind, text) => set({ feedback: { id: ++feedbackId, kind, text } }),
  clearFeedback: () => set({ feedback: null }),
  setListenWordIndex: (listenWordIndex) => set({ listenWordIndex }),

  setEchoReadingWord: (tokenIndex) =>
    set((state) => {
      // Move the single "current" highlight to the sounding word, leaving already-read
      // (and assisted) words from earlier sentences untouched.
      const wordStates: WordState[] = state.wordStates.map((s) => (s === "current" ? "pending" : s));
      if (tokenIndex >= 0 && tokenIndex < wordStates.length) wordStates[tokenIndex] = "current";
      return { wordStates };
    }),
}));
