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

/** How many times each line has to play before the words show: twice with Listen twice on, since a
 * second listen is the usual practice for listening and the first leaves the most unheard. */
export function listensNeeded(twice: boolean): 1 | 2 {
  return twice ? 2 : 1;
}

/** Whether every line with audio has played to its end `times` times (`heard`: how many times each
 * line, by position, has). A line repeated by Repeat line counts each play. */
export function allHeard(lines: readonly { audio: boolean }[], heard: ReadonlyMap<number, number>, times = 1): boolean {
  return lines.every((line, i) => !line.audio || (heard.get(i) ?? 0) >= times);
}
