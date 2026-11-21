/**
 * What the app says when something fails: what happened, then what to do (CLAUDE.md, User-facing
 * copy). An error raised on purpose, with a message written for a person, is a `Refusal`: its
 * message gives the reason and the next step, so it's shown as it is. Anything else (SQLite, the
 * file system, a bug) was never written for a person, so the app's own sentence comes first and
 * the error's text follows in parentheses, only so a screenshot still says what broke.
 */

/** An error whose message is written for a person: the reason, and what to do about it. */
export class Refusal extends Error {}

/**
 * The error's own text, cleaned up to follow a sentence: an expo native error's wrapper ("Call to
 * function '...' has been rejected. → Caused by: ...") cut down to its cause, on one line, without a
 * closing period. Empty when there's nothing to say.
 */
export function errorDetail(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : e == null ? '' : String(e);
  const cause = raw.lastIndexOf('Caused by:');
  return (cause < 0 ? raw : raw.slice(cause + 'Caused by:'.length)).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/**
 * The text for a failure. `what` says what failed ("Couldn't save the note."), left out when an
 * alert's title already says it; `next` says what to do, for an error that isn't a refusal.
 */
export function failureText(e: unknown, { what, next }: { what?: string; next: string }): string {
  if (e instanceof Refusal) return [what, e.message].filter(Boolean).join(' ');
  const detail = errorDetail(e);
  const said = [what, next].filter(Boolean).join(' ');
  return detail ? `${said} (${detail})` : said;
}

/**
 * A failure message split for display: "Couldn't save the note. The disk is full." is the title
 * "Couldn't save the note" and the reason "The disk is full.". Only a message that opens with
 * "Couldn't" and has more after its first sentence splits; anything else is all reason, since its
 * first sentence may not name what failed.
 */
export function splitFailure(message: string): { title?: string; reason: string } {
  const m = /^(Couldn't [^.]*)\.\s+(\S[\s\S]*)$/.exec(message.trim());
  return m ? { title: m[1], reason: m[2] } : { reason: message };
}
