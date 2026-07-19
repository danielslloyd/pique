"use client";

import { useWizardStore } from "@/stores/wizardStore";
import Step1Characters from "./Step1Characters";
import Step2Idea from "./Step2Idea";
import Step3Story from "./Step3Story";
import Step4Pictures from "./Step4Pictures";
import Step5Finish from "./Step5Finish";
import WizardShell from "./WizardShell";

export default function CreatePage() {
  const step = useWizardStore((s) => s.step);
  const reset = useWizardStore((s) => s.reset);

  return (
    <WizardShell step={step} onStartOver={reset}>
      {step === 1 && <Step1Characters />}
      {step === 2 && <Step2Idea />}
      {step === 3 && <Step3Story />}
      {step === 4 && <Step4Pictures />}
      {step === 5 && <Step5Finish />}
    </WizardShell>
  );
}
