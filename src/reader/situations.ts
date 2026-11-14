// Situations (docs/read-and-listen/architecture.md, Situations): a scene talked through with Claude, who plays
// the other person from the deck's words. The conversation lives here, in the app, and goes to the server with
// each turn. What's worth keeping in it, and what a line the owner wrote holds. Pure, so it's tested; nothing
// here grades a card or writes a note.
import type { SituationConversation, SituationLine, SituationRoles, SituationTurn } from './api';

/** Lines in a conversation; the server takes no more. The screen offers to finish before it's reached. */
export const MAX_LINES = 40;
/** Characters in one of the owner's lines, as the server takes them. */
export const MAX_LINE = 400;

/** A line of theirs as the screen keeps it: the turn the server sent. A line of the owner's is just its text. */
export type ChatLine = { speaker: 'them'; turn: SituationTurn } | { speaker: 'you'; text: string };

export interface Chat {
  language: SituationConversation['language'];
  scene: string;
  roles: SituationRoles | null;
  lines: ChatLine[];
  /** Their last line ended the scene. */
  done: boolean;
}

export function startChat(language: Chat['language'], scene: string): Chat {
  return { language, scene: scene.trim(), roles: null, lines: [], done: false };
}

/** What goes to the server: the scene, the parts, and every line as text. */
export function conversationOf(chat: Chat): SituationConversation {
  const lines: SituationLine[] = chat.lines.map((l) => (l.speaker === 'them' ? { speaker: 'them', text: l.turn.line } : { speaker: 'you', text: l.text }));
  return { language: chat.language, scene: chat.scene, roles: chat.roles, lines };
}

/** The chat with their line added: the parts from a first turn, and whether it ended the scene. */
export function withTheirs(chat: Chat, turn: SituationTurn): Chat {
  return { ...chat, roles: chat.roles ?? turn.roles ?? null, lines: [...chat.lines, { speaker: 'them', turn }], done: turn.done };
}

/** The chat with the owner's line added, its spacing tidied. */
export function withMine(chat: Chat, text: string): Chat {
  return { ...chat, lines: [...chat.lines, { speaker: 'you', text: tidy(text) }] };
}

/** Takes back the owner's last line, when the turn it asked for failed, so it can be sent again. */
export function withoutMine(chat: Chat): { chat: Chat; text: string } | null {
  const last = chat.lines[chat.lines.length - 1];
  if (!last || last.speaker !== 'you') return null;
  return { chat: { ...chat, lines: chat.lines.slice(0, -1) }, text: last.text };
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Whether a line can be sent: something in it, under the length the server takes, and room for their reply. */
export function canSend(chat: Chat, text: string): boolean {
  const t = tidy(text);
  return !!t && t.length <= MAX_LINE && !chat.done && chat.lines.length + 2 <= MAX_LINES && chat.lines[chat.lines.length - 1]?.speaker === 'them';
}

/** Whether there's anything to give feedback on: a line of the owner's. */
export function canFinish(chat: Chat): boolean {
  return chat.lines.some((l) => l.speaker === 'you');
}

/** The English words written in [brackets] in a line, for a word not known: shown as asked-for in the line. */
export function bracketed(text: string): string[] {
  return [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** A line of the owner's split into its own words and the [bracketed] English ones, for drawing them apart. */
export function lineParts(text: string): { text: string; asked: boolean }[] {
  const out: { text: string; asked: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/\[([^\]]*)\]/g)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), asked: false });
    out.push({ text: m[0], asked: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), asked: false });
  return out;
}
