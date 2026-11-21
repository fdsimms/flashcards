/**
 * How casual or formal the text Claude writes sounds (server `register.py`): a default in Settings,
 * and a cram or a Situations scene can choose its own. Not the register chip on a text's line
 * (`register.ts`), which labels what was written.
 */
export type RegisterLevel = 'casual' | 'everyday' | 'formal';

/** What the server uses when nothing says otherwise: `register.DEFAULT`. */
export const DEFAULT_REGISTER: RegisterLevel = 'everyday';

export const REGISTER_LEVELS: { value: RegisterLevel; label: string; help: string }[] = [
  { value: 'casual', label: 'Casual', help: 'Between friends or family.' },
  { value: 'everyday', label: 'Everyday', help: "How most people talk, polite enough for a tutor or a shop." },
  { value: 'formal', label: 'Formal', help: "For work, an interview, or someone you don't know." },
];

export function isRegisterLevel(value: unknown): value is RegisterLevel {
  return value === 'casual' || value === 'everyday' || value === 'formal';
}

export function registerLabel(level: RegisterLevel): string {
  return REGISTER_LEVELS.find((l) => l.value === level)!.label;
}

/** The register a cram or scene writes in: its own choice, else Settings', else the default. Used to show it; a request sends only a choice made here (`registerChoice`) so the server applies Settings itself. */
export function effectiveRegister(own: RegisterLevel | undefined, settings: RegisterLevel | undefined): RegisterLevel {
  return own ?? settings ?? DEFAULT_REGISTER;
}

/** The part of a request that carries a cram's or scene's own register: nothing when it follows Settings. */
export function registerChoice(own: RegisterLevel | undefined): { register?: RegisterLevel } {
  return own ? { register: own } : {};
}

/** The sentence under a register control: what the level means, and where it came from when it's the default. */
export function registerHelp(own: RegisterLevel | undefined, settings: RegisterLevel | undefined): string {
  const level = effectiveRegister(own, settings);
  const meaning = REGISTER_LEVELS.find((l) => l.value === level)!.help;
  return own ? meaning : `Following Settings: ${registerLabel(level)}. ${meaning}`;
}
