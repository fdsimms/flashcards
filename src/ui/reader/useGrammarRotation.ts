import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { GrammarAnswer } from '../../core/grammarDrills';
import type { Api, GrammarRotation } from '../../reader/api';
import { allSent, answersToSend, sentThroughAfter } from '../../reader/rotation';
import { loadAnswersSentThrough, saveAnswersSentThrough } from '../../reader/storage';

/** Batches sent in one go at most, so a phone that can't keep the mark doesn't loop. */
const MAX_BATCHES = 20;

let sending: Promise<void> | null = null;

/**
 * Sends the practice answers the server doesn't have yet (rotation.ts), so it can tell when a
 * practiced point is learned. Asked after a drill round and when the shelf opens; one call at a
 * time. Offline or refused, it stops quietly and the answers go next time: nothing is lost, as the
 * phone keeps its own.
 */
export function sendGrammarAnswers(api: Api, answers: { listGrammarAnswers(): Promise<GrammarAnswer[]> }): Promise<void> {
  sending ??= (async () => {
    try {
      const all = await answers.listGrammarAnswers();
      let mark = await loadAnswersSentThrough();
      for (let i = 0; i < MAX_BATCHES && !allSent(all, mark); i++) {
        const batch = answersToSend(all, mark);
        await api.sendGrammarAnswers(batch);
        mark = sentThroughAfter(batch, mark);
        if (mark) saveAnswersSentThrough(mark);
      }
    } catch {
      // Sent the next time the shelf opens or a round ends.
    } finally {
      sending = null;
    }
  })();
  return sending;
}

/**
 * The language's automatic grammar swaps still to show on the shelf, asked each time it comes into
 * view, after sending any new practice answers. Nothing is shown while the server can't be reached.
 */
export function useGrammarRotations(api: Api, answers: { listGrammarAnswers(): Promise<GrammarAnswer[]> }) {
  const [rotations, setRotations] = useState<GrammarRotation[]>([]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    void sendGrammarAnswers(api, answers)
      .then(() => api.grammarRotations())
      .then((r) => { if (alive) setRotations(r.rotations); }, () => undefined);
    return () => { alive = false; };
  }, [api, answers]));
  const drop = (id: number) => setRotations((list) => list.filter((r) => r.id !== id));
  return { rotations, drop };
}
