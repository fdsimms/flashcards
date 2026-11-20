import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/**
 * Writes the answers still owed to the kept Anki collection (owedAnswers.ts): the ones an earlier
 * run of the app saved in Franki's tables but never got into the collection, because it was closed
 * while the collection was busy. In the order they were given. Each card is saved again after its
 * answer, as Review does: a sync that finished in between read the collection, without the answer,
 * back over it. Returns how many the collection refused; those are dropped, not tried forever.
 */
export async function settleOwedAnkiAnswers(repo: Pick<Repo, 'saveCard'> & Pick<AnkiLink, 'owedAnkiAnswers' | 'writeAnkiAnswer' | 'forgetOwedAnkiAnswer'>): Promise<number> {
  let refused = 0;
  for (const { id, owed } of await repo.owedAnkiAnswers()) {
    try {
      // Undefined when there was nothing to write: already written, or the card isn't in this collection.
      if (!(await repo.writeAnkiAnswer({ ...owed.answer, owedId: id }))) continue;
      await repo.saveCard(owed.answer.after);
      for (const b of owed.buried) await repo.saveCard(b);
    } catch {
      refused++;
      await repo.forgetOwedAnkiAnswer(id).catch(() => undefined);
    }
  }
  return refused;
}
