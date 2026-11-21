import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTER, effectiveRegister, isRegisterLevel, registerChoice, registerHelp, registerLabel, REGISTER_LEVELS } from '../../src/reader/registerLevel';

describe('registerLevel', () => {
  it('names three levels, with Everyday the default', () => {
    expect(REGISTER_LEVELS.map((l) => l.value)).toEqual(['casual', 'everyday', 'formal']);
    expect(DEFAULT_REGISTER).toBe('everyday');
    expect(isRegisterLevel('formal')).toBe(true);
    expect(isRegisterLevel('slang')).toBe(false);
    expect(isRegisterLevel(undefined)).toBe(false);
  });

  it("takes a cram's own choice, else Settings', else the default", () => {
    expect(effectiveRegister('casual', 'formal')).toBe('casual');
    expect(effectiveRegister(undefined, 'formal')).toBe('formal');
    expect(effectiveRegister(undefined, undefined)).toBe('everyday');
  });

  it('sends only a choice made on the cram or scene, so Settings applies on the server', () => {
    expect(registerChoice(undefined)).toEqual({});
    expect(registerChoice('formal')).toEqual({ register: 'formal' });
  });

  it('says where the default comes from', () => {
    expect(registerHelp(undefined, 'formal')).toMatch(/^Following Settings: Formal\./);
    expect(registerHelp('casual', 'formal')).toBe('Between friends or family.');
    expect(registerLabel('everyday')).toBe('Everyday');
  });

  it('uses no em dashes in what it shows', () => {
    for (const l of REGISTER_LEVELS) expect(`${l.label}${l.help}`).not.toContain('—');
  });
});
