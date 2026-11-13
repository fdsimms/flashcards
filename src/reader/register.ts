import type { NaturalVerdict, Register } from './api';

// What the reader says about how a line is said: the register chip at the end of a line's
// buttons, and the verdict when the owner asks "Does this sound natural?". Both only show text.

const REGISTER_LABELS: Record<Register, string> = {
  casual: 'Casual',
  neutral: 'Neutral',
  formal: 'Formal',
  slang: 'Slang',
};

/**
 * The chip's label for a line's register, or null when there is none to show: a text written
 * before the server was asked, a server older than that, or a word outside the list.
 */
export function registerLabel(register: string | undefined): string | null {
  return register !== undefined && Object.hasOwn(REGISTER_LABELS, register) ? REGISTER_LABELS[register as Register] : null;
}

const VERDICT_LABELS: Record<NaturalVerdict, string> = {
  natural: 'Natural',
  stiff: 'Stiff here',
  unusual: 'Unusual',
};

/** The badge's label for a verdict. */
export function verdictLabel(verdict: NaturalVerdict): string {
  return VERDICT_LABELS[verdict];
}

/** Whether a verdict is a note that something is off, drawn in the warning color. */
export function isOff(verdict: NaturalVerdict): boolean {
  return verdict !== 'natural';
}
