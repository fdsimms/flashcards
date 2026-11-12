/**
 * The drawn characters a dialogue's speakers are shown as, in place of the A and B badges
 * (docs/read-and-listen/architecture.md, Characters).
 *
 * The server picks a character for each speaker when it writes the text (`server/reader/.../characters.py`,
 * which has the same keys; `test_characters.py` checks the two lists match), and the speaker's gender
 * says which version to draw: a parent is a father or a mother. A drawing is a list of shapes, each
 * naming a tone rather than a color, so the screen paints them from the theme (`ReadCharacter.tsx`).
 * Pure, so the list is tested.
 */

import type { ReaderText } from './api';

export const CHARACTERS = [
  'parent',
  'grandparent',
  'child',
  'friend',
  'waiter',
  'shopkeeper',
  'doctor',
  'teacher',
  'traveler',
  'person',
] as const;
export type CharacterKey = (typeof CHARACTERS)[number];
export type CharacterGender = 'male' | 'female';

/** What a part is painted in: the speaker's strongest color, then two softer ones, and white-ish. */
export type Tone = 'hair' | 'body' | 'face' | 'acc';

type Geometry =
  | { d: string }
  | { circle: [cx: number, cy: number, r: number] }
  | { ellipse: [cx: number, cy: number, rx: number, ry: number] }
  | { rect: [x: number, y: number, width: number, height: number, rx?: number] };

/** `stroke` draws an outline of that width with no fill; `head` parts move with the head's scale. */
export type Shape = Geometry & { tone: Tone; stroke?: number; head?: boolean };

export type Drawing = {
  shapes: Shape[];
  /** A child's head is drawn larger than an adult's, about the point between head and shoulders. */
  headScale: number;
};

/** The canvas the shapes are drawn on, and where the head scales from. */
export const VIEW_BOX = 48;
export const HEAD_ORIGIN = { x: 24, y: 38 };

type Hair = 'short' | 'long' | 'bob' | 'bun' | 'pigtails' | 'ponytail' | 'sides' | 'spiky' | 'cap' | 'capPony';
type Extra = 'glasses' | 'beard' | 'mustache' | 'headphones' | 'bowtie' | 'tie' | 'apron' | 'stethoscope' | 'straps' | 'smile';

type Look = { hair: Hair; extras: Extra[]; kid?: boolean };

const LOOKS: Record<CharacterKey, Record<CharacterGender, Look>> = {
  parent: { male: { hair: 'short', extras: ['beard'] }, female: { hair: 'long', extras: ['smile'] } },
  grandparent: {
    male: { hair: 'sides', extras: ['glasses', 'mustache'] },
    female: { hair: 'bun', extras: ['glasses', 'smile'] },
  },
  child: {
    male: { hair: 'short', kid: true, extras: ['smile'] },
    female: { hair: 'pigtails', kid: true, extras: ['smile'] },
  },
  friend: {
    male: { hair: 'short', extras: ['headphones', 'smile'] },
    female: { hair: 'bob', extras: ['headphones', 'smile'] },
  },
  waiter: { male: { hair: 'short', extras: ['bowtie', 'smile'] }, female: { hair: 'bun', extras: ['bowtie', 'smile'] } },
  shopkeeper: {
    male: { hair: 'short', extras: ['apron', 'mustache'] },
    female: { hair: 'ponytail', extras: ['apron', 'smile'] },
  },
  doctor: {
    male: { hair: 'short', extras: ['stethoscope', 'smile'] },
    female: { hair: 'bob', extras: ['stethoscope', 'smile'] },
  },
  teacher: {
    male: { hair: 'short', extras: ['glasses', 'tie', 'smile'] },
    female: { hair: 'long', extras: ['glasses', 'smile'] },
  },
  traveler: {
    male: { hair: 'cap', extras: ['straps', 'smile'] },
    female: { hair: 'capPony', extras: ['straps', 'smile'] },
  },
  person: { male: { hair: 'short', extras: ['smile'] }, female: { hair: 'bob', extras: ['smile'] } },
};

const SHORT: Shape = {
  d: 'M15 22C14 11 19 8.6 24 8.6C29 8.6 34 11 33 22C31.8 17 28.5 15.4 24 15.4C19.5 15.4 16.2 17 15 22Z',
  tone: 'hair',
  head: true,
};
const SPIKY: Shape = {
  d: 'M15 22C13.6 12 16 9 17.5 9.4L19.6 6.8L22 9.2L24.4 6.4L26.6 9.2L29 7L30.6 9.6C33.6 10 34.4 14 33 22C31.8 17 28.5 15.4 24 15.4C19.5 15.4 16.2 17 15 22Z',
  tone: 'hair',
  head: true,
};
const CAP: Shape[] = [
  { d: 'M15 16.2C15 7.8 19.6 6 24 6C28.4 6 33 7.8 33 16.2Z', tone: 'hair', head: true },
  { d: 'M13.6 15.8H36.6C36.6 17.4 35.4 18.2 33.6 18.2H15C14.2 18.2 13.6 17.2 13.6 15.8Z', tone: 'body', head: true },
];
const PONYTAIL: Shape = { d: 'M32 14C37 13 38.5 20 35.5 26C34.6 23.6 34 21 32.6 19Z', tone: 'hair' };

// Hair behind the head and shoulders, then in front of the head.
const HAIR_BACK: Partial<Record<Hair, Shape[]>> = {
  long: [{
    d: 'M14 22C13.4 10 19 8 24 8C29 8 34.6 10 34 22L34.6 35C34.6 36.6 31.6 37 30.4 36.2L30 24L18 24L17.6 36.2C16.4 37 13.4 36.6 13.4 35Z',
    tone: 'hair',
  }],
  bob: [{
    d: 'M14.4 22C14 10 19.4 8.4 24 8.4C28.6 8.4 34 10 33.6 22L34 30.5C34 32 31.5 32.4 30.5 31.5L30 24L18 24L17.5 31.5C16.5 32.4 14 32 14 30.5Z',
    tone: 'hair',
  }],
  pigtails: [{ circle: [13.6, 27, 3.4], tone: 'hair' }, { circle: [34.4, 27, 3.4], tone: 'hair' }],
  bun: [{ circle: [24, 7.4, 3.9], tone: 'hair' }],
  ponytail: [PONYTAIL],
  capPony: [PONYTAIL],
};
const HAIR_FRONT: Record<Hair, Shape[]> = {
  short: [SHORT],
  long: [SHORT],
  bob: [SHORT],
  bun: [SHORT],
  pigtails: [SHORT],
  ponytail: [SHORT],
  spiky: [SPIKY],
  sides: [
    // Thin crescents along the temples, inside the head's edge: a bald top with hair at the sides.
    { d: 'M17.2 15C15.2 17 14.7 21 15.1 24.4C15.3 25.6 15.7 26.6 16.3 27.2C16.9 24.8 17 21 19 16.2C18.4 15.6 17.8 15.2 17.2 15Z', tone: 'hair', head: true },
    { d: 'M30.8 15C32.8 17 33.3 21 32.9 24.4C32.7 25.6 32.3 26.6 31.7 27.2C31.1 24.8 31 21 29 16.2C29.6 15.6 30.2 15.2 30.8 15Z', tone: 'hair', head: true },
  ],
  cap: CAP,
  capPony: CAP,
};

const BODY_EXTRAS: Partial<Record<Extra, Shape[]>> = {
  bowtie: [
    { d: 'M24 38.6L19.2 36.2V41Z', tone: 'hair' },
    { d: 'M24 38.6L28.8 36.2V41Z', tone: 'hair' },
    { circle: [24, 38.6, 1.3], tone: 'hair' },
  ],
  tie: [{ d: 'M24 38L22.4 39.6L23.2 46.5L24 48L24.8 46.5L25.6 39.6Z', tone: 'hair' }],
  apron: [
    { d: 'M16.4 48L18.4 40.2H29.6L31.6 48Z', tone: 'acc' },
    { d: 'M18.6 40.4L20.6 36.6M29.4 40.4L27.4 36.6', tone: 'acc', stroke: 1.4 },
  ],
  stethoscope: [
    { d: 'M17.6 37C16.2 44.4 19.8 46.4 24 46.4C28.2 46.4 31.8 44.4 30.4 37', tone: 'acc', stroke: 1.5 },
    { circle: [24, 46.4, 1.7], tone: 'acc' },
  ],
  straps: [{ d: 'M15.4 39.5C15.2 43.5 15.6 46 16.2 48M32.6 39.5C32.8 43.5 32.4 46 31.8 48', tone: 'acc', stroke: 2.4 }],
};
const HEAD_EXTRAS: Partial<Record<Extra, Shape[]>> = {
  glasses: [
    // Square frames wider than the eyes, a bridge and arms back to the head's edge: round rings with
    // a dot inside read as big eyes, not glasses.
    { rect: [16.9, 18.2, 6.6, 5.6, 1.8], tone: 'hair', stroke: 1.3, head: true },
    { rect: [24.5, 18.2, 6.6, 5.6, 1.8], tone: 'hair', stroke: 1.3, head: true },
    { d: 'M23.5 20.4H24.5M16.9 20.2L15.6 19.8M31.1 20.2L32.4 19.8', tone: 'hair', stroke: 1.1, head: true },
  ],
  beard: [{
    d: 'M15.7 24C15.9 33 20 34.4 24 34.4C28 34.4 32.1 33 32.3 24C30.8 28 27.4 29.2 24 29.2C20.6 29.2 17.2 28 15.7 24Z',
    tone: 'hair',
    head: true,
  }],
  mustache: [{
    d: 'M19.8 26.8Q22 25.2 24 26.6Q26 25.2 28.2 26.8Q26.2 29 24 27.8Q21.8 29 19.8 26.8Z',
    tone: 'hair',
    head: true,
  }],
  headphones: [
    { d: 'M14.4 22C13.8 8 34.2 8 33.6 22', tone: 'body', stroke: 1.8, head: true },
    { rect: [12.8, 20, 3.4, 6, 1.6], tone: 'body', head: true },
    { rect: [31.8, 20, 3.4, 6, 1.6], tone: 'body', head: true },
  ],
  smile: [{ d: 'M21.8 28Q24 29.8 26.2 28', tone: 'hair', stroke: 1, head: true }],
};

/** The look a second speaker of the same character and gender takes, so the two can be told apart. */
function variantOf(look: Look, gender: CharacterGender): Look {
  if (look.hair === 'cap' || look.hair === 'capPony') {
    const extras = look.extras.includes('glasses') ? look.extras.filter((e) => e !== 'glasses') : [...look.extras, 'glasses' as const];
    return { ...look, extras };
  }
  const alt: Hair = gender === 'male' ? (look.hair === 'spiky' ? 'short' : 'spiky') : look.hair === 'bob' ? 'long' : 'bob';
  return { ...look, hair: alt };
}

export function isCharacterKey(value: unknown): value is CharacterKey {
  return typeof value === 'string' && (CHARACTERS as readonly string[]).includes(value);
}

/** The shapes of one character, back to front. `variant`: the second of two alike. */
export function drawCharacter(key: CharacterKey, gender: CharacterGender, variant = false): Drawing {
  let look = LOOKS[key][gender];
  if (variant) look = variantOf(look, gender);
  const body = look.kid
    ? 'M9 48C9 40.5 14 36.5 24 36.5C34 36.5 39 40.5 39 48Z'
    : 'M4 48C4 40.5 11 36 24 36C37 36 44 40.5 44 48Z';
  const shapes: Shape[] = [
    ...(HAIR_BACK[look.hair] ?? []),
    // The neck runs down behind the shoulders, so there is never a gap between them.
    { rect: [20.5, 29, 7, 14], tone: 'face' },
    { d: body, tone: 'body' },
    ...look.extras.flatMap((e) => BODY_EXTRAS[e] ?? []),
    { ellipse: [24, 22, 8.6, 9.6], tone: 'face', head: true },
    ...HAIR_FRONT[look.hair],
    ...look.extras.flatMap((e) => HEAD_EXTRAS[e] ?? []),
    { circle: [20.4, 21, 0.9], tone: 'hair', head: true },
    { circle: [27.6, 21, 0.9], tone: 'hair', head: true },
  ];
  return { shapes, headScale: look.kid ? 1.1 : 1 };
}

export type SpeakerCharacter = { key: CharacterKey; gender: CharacterGender; variant: boolean };

/**
 * The character to draw for a dialogue's speaker, or null to show the A or B badge: a text from
 * before characters, one the server gave a key this app doesn't know, or a speaker with no gender.
 */
export function speakerCharacter(text: Pick<ReaderText, 'characters' | 'genders'>, who: 'A' | 'B'): SpeakerCharacter | null {
  const key = text.characters?.[who];
  const gender = text.genders?.[who];
  if (!isCharacterKey(key) || (gender !== 'male' && gender !== 'female')) return null;
  const other = who === 'A' ? 'B' : 'A';
  // Both speakers share a character and a gender: the second is drawn differently.
  const variant = who === 'B' && text.characters?.[other] === key && text.genders?.[other] === gender;
  return { key, gender, variant };
}
