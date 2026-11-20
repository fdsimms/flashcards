import { useEffect } from 'react';
import { Alert } from 'react-native';
import { settleOwedAnkiAnswers } from '../anki/owedService';
import { ankiWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/**
 * At launch, writes the answers a run before this one left owed to the Anki collection
 * (src/anki/owedAnswers.ts). Queued where Review queues its own, so everything that waits for the
 * answers to be written (`reviewWrites.idle()`: the launch sync, the deck list's counts) waits for
 * these too. Called by AppContext before its first sync.
 */
export function useOwedAnswers(repo: (Repo & AnkiLink) | null) {
  useEffect(() => {
    if (!repo) return;
    void ankiWrites.add(async () => {
      const refused = await settleOwedAnkiAnswers(repo).catch(() => 0);
      if (refused) {
        Alert.alert(
          refused === 1 ? "Couldn't save an answer for Anki" : `Couldn't save ${refused} answers for Anki`,
          `${refused === 1 ? 'It was' : 'They were'} given before Franki was last closed. ${refused === 1 ? 'It counts' : 'They count'} in Franki, but won't be in what's synced or sent to Anki.`,
        );
      }
    });
  }, [repo]);
}
