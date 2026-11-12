import { describe, expect, it } from 'vitest';
import { CHARACTERS, drawCharacter, isCharacterKey, speakerCharacter } from '../../src/reader/characters';

const GENDERS = ['male', 'female'] as const;

describe('drawCharacter', () => {
  it('draws every character in both genders', () => {
    for (const key of CHARACTERS) {
      for (const gender of GENDERS) {
        const { shapes } = drawCharacter(key, gender);
        expect(shapes.length, `${key} ${gender}`).toBeGreaterThan(5);
      }
    }
  });

  it('draws a man and a woman differently', () => {
    for (const key of CHARACTERS) {
      expect(drawCharacter(key, 'male').shapes, key).not.toEqual(drawCharacter(key, 'female').shapes);
    }
  });

  it('keeps the neck running down behind the shoulders, so there is never a gap', () => {
    for (const key of CHARACTERS) {
      for (const gender of GENDERS) {
        const { shapes } = drawCharacter(key, gender);
        const neck = shapes.find((s) => 'rect' in s && s.tone === 'face' && !s.head);
        expect(neck && 'rect' in neck ? neck.rect[1] + neck.rect[3] : 0, `${key} ${gender}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('draws a child with a larger head than an adult', () => {
    expect(drawCharacter('child', 'male').headScale).toBeGreaterThan(drawCharacter('parent', 'male').headScale);
  });

  it('draws the second of two alike differently from the first', () => {
    for (const key of CHARACTERS) {
      for (const gender of GENDERS) {
        expect(drawCharacter(key, gender, true).shapes, `${key} ${gender}`).not.toEqual(drawCharacter(key, gender).shapes);
      }
    }
  });

  it('puts every part of the head after the body, so the head scales as one group', () => {
    for (const key of CHARACTERS) {
      const { shapes } = drawCharacter(key, 'female');
      const firstHead = shapes.findIndex((s) => s.head);
      expect(shapes.slice(firstHead).every((s) => s.head), key).toBe(true);
    }
  });
});

describe('speakerCharacter', () => {
  const dialogue = { characters: { A: 'child', B: 'parent' }, genders: { A: 'female', B: 'male' } };

  it('picks the character and the gender of each speaker', () => {
    expect(speakerCharacter(dialogue, 'A')).toEqual({ key: 'child', gender: 'female', variant: false });
    expect(speakerCharacter(dialogue, 'B')).toEqual({ key: 'parent', gender: 'male', variant: false });
  });

  it('varies only the second of two speakers who share a character and a gender', () => {
    const friends = { characters: { A: 'friend', B: 'friend' }, genders: { A: 'male', B: 'male' } };
    expect(speakerCharacter(friends, 'A')?.variant).toBe(false);
    expect(speakerCharacter(friends, 'B')?.variant).toBe(true);
  });

  it('does not vary two of one character who are a man and a woman', () => {
    const pair = { characters: { A: 'waiter', B: 'waiter' }, genders: { A: 'male', B: 'female' } };
    expect(speakerCharacter(pair, 'B')?.variant).toBe(false);
  });

  it('shows the badge for an older text, an unknown key, or a speaker with no gender', () => {
    expect(speakerCharacter({}, 'A')).toBeNull();
    expect(speakerCharacter({ characters: { A: 'wizard' }, genders: { A: 'male' } }, 'A')).toBeNull();
    expect(speakerCharacter({ characters: { A: 'child' }, genders: {} }, 'A')).toBeNull();
    expect(isCharacterKey('wizard')).toBe(false);
  });
});
