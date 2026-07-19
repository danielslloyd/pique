import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DraftPage, ReadingLevel } from "@/lib/wizard-api";

export type WizardStep = 1 | 2 | 3 | 4 | 5;

interface WizardState {
  step: WizardStep;

  // Step 1
  characterIds: number[];
  styleId: number | null;

  // Step 2
  theme: string;
  readingLevel: ReadingLevel;
  pageCount: number;

  // Step 3
  title: string;
  pages: DraftPage[];

  // Step 4/5
  bookId: number | null;
  finalizeJobId: number | string | null;

  setStep: (step: WizardStep) => void;
  toggleCharacter: (id: number, styleId: number) => void;
  setTheme: (theme: string) => void;
  setReadingLevel: (level: ReadingLevel) => void;
  setPageCount: (count: number) => void;
  setDraft: (title: string, pages: DraftPage[]) => void;
  setTitle: (title: string) => void;
  replacePage: (page: DraftPage) => void;
  updatePageDraft: (pageNo: number, patch: Partial<DraftPage>) => void;
  setBookId: (id: number) => void;
  setFinalizeJobId: (id: number | string | null) => void;
  reset: () => void;
}

const initialState = {
  step: 1 as WizardStep,
  characterIds: [] as number[],
  styleId: null as number | null,
  theme: "",
  readingLevel: "k" as ReadingLevel,
  pageCount: 6,
  title: "",
  pages: [] as DraftPage[],
  bookId: null as number | null,
  finalizeJobId: null as number | string | null,
};

export const useWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),

      toggleCharacter: (id, styleId) =>
        set((state) => {
          const isSelected = state.characterIds.includes(id);
          if (isSelected) {
            const characterIds = state.characterIds.filter((c) => c !== id);
            return { characterIds, styleId: characterIds.length > 0 ? state.styleId : null };
          }
          if (state.characterIds.length >= 3) return state;
          if (state.styleId !== null && state.styleId !== styleId) return state;
          return { characterIds: [...state.characterIds, id], styleId };
        }),

      setTheme: (theme) => set({ theme }),
      setReadingLevel: (readingLevel) => set({ readingLevel }),
      setPageCount: (pageCount) => set({ pageCount }),

      setDraft: (title, pages) => set({ title, pages }),
      setTitle: (title) => set({ title }),
      replacePage: (page) =>
        set((state) => ({
          pages: state.pages.map((p) => (p.page_no === page.page_no ? page : p)),
        })),
      updatePageDraft: (pageNo, patch) =>
        set((state) => ({
          pages: state.pages.map((p) => (p.page_no === pageNo ? { ...p, ...patch } : p)),
        })),

      setBookId: (bookId) => set({ bookId }),
      setFinalizeJobId: (finalizeJobId) => set({ finalizeJobId }),

      reset: () => set({ ...initialState }),
    }),
    { name: "pique-wizard" }
  )
);
