import type { TextStage } from './api';

/** One step of something being made, as the "making" card lists it. */
export type StageStep = { label: string; status: 'done' | 'now' | 'todo' };

/** The steps with where the work is: those before its stage done, its own now, the rest to come. A missing or unknown stage is the first. */
export function stepsAt<S extends string>(stages: readonly { stage: S; label: string }[], stage: S | null | undefined): StageStep[] {
  const at = Math.max(0, stages.findIndex((s) => s.stage === stage));
  return stages.map((s, i) => ({ label: s.label, status: i < at ? 'done' : i === at ? 'now' : 'todo' }));
}

/** The label of the step under way ("Adding the translations"), for a place too small to list them all. */
export function currentStep(steps: StageStep[]): string {
  return (steps.find((s) => s.status === 'now') ?? steps[0]).label;
}

/** What writing a text goes through on the server, in order (engine.py's `TextStage`). */
export const TEXT_STAGES: readonly { stage: TextStage; label: string }[] = [
  { stage: 'writing', label: 'Writing the text' },
  { stage: 'translating', label: 'Adding the translations' },
  { stage: 'recording', label: 'Recording the voices' },
];

export function textSteps(stage: TextStage | null | undefined): StageStep[] {
  return stepsAt(TEXT_STAGES, stage);
}
