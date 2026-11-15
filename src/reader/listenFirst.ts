// Listen before reading (docs/read-and-listen/architecture.md, Client, Listen before reading): with
// the setting on, a new text opens with its words hidden, and they appear once every line has been
// heard through. Listening comes first, with nothing to read along with, and the words then show
// whether it was understood. Pure, so it's tested; Reader.tsx holds the state.

/** Whether a text opens with its words hidden: the setting is on, and it's a new text (a past one
 * has its own Listen without the text, and Play all is for listening with the screen off) that has
 * audio to listen to. */
export function listensFirst(on: boolean, sourceKind: 'shelf' | 'topic' | 'past', playAll: boolean, hasAudio: boolean): boolean {
  return on && hasAudio && sourceKind !== 'past' && !playAll;
}

/** Whether every line with audio has played to its end (`heard`: the lines' positions). */
export function allHeard(lines: readonly { audio: boolean }[], heard: ReadonlySet<number>): boolean {
  return lines.every((line, i) => !line.audio || heard.has(i));
}
