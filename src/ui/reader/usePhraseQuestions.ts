import { useEffect, useRef, useState } from 'react';
import { withQuestion, type AskTurn } from '../../core/askCard';
import { failureText } from '../../core/failure';
import type { Api } from '../../reader/api';
import { prefs } from '../../reader/storage';

/**
 * The questions asked about the selected phrase and Claude's answers, for the phrase popup. They
 * are sent again with each follow-up (the server adds the line and the text); nothing is asked
 * until a question is sent. The server keeps the conversation for a couple of hours after its
 * last answer, so reopening the popup on the same phrase (after swiping it away, say) loads it
 * back. Nothing is graded or added to the deck.
 */
export function usePhraseQuestions(api: Api, textId: number, line: number, toLine: number, phrase: string) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second send mustn't start while one is on its way (the state lags a tap).
  const busy = useRef(false);
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);
  // The kept conversation, unless a question was already sent before it arrived. Not being able to
  // load it (offline, an older server) just starts a new one.
  useEffect(() => {
    api.phraseChat(textId, line, phrase).then((kept) => {
      if (open.current && !busy.current) setTurns((now) => (now.length ? now : kept));
    }).catch(() => {});
    // Once per phrase; a new phrase mounts a new popup.
  }, []);

  const send = async (question: string, from: AskTurn[] = turns) => {
    if (busy.current || !question.trim()) return false;
    busy.current = true;
    const next = withQuestion(from, question);
    setTurns(next);
    setAsking(true);
    setError(null);
    try {
      const answer = await api.askPhrase(textId, line, toLine, phrase, next, prefs().explainInLanguage);
      if (open.current) setTurns([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      if (open.current) setError(failureText(e, { what: "Couldn't get an answer.", next: 'Try again.' }));
    } finally {
      busy.current = false;
      if (open.current) setAsking(false);
    }
    return true;
  };

  // A question that failed stays on screen as the last turn with the error under it; Try again sends it once more.
  const failed = error && turns.at(-1)?.role === 'user' ? turns.at(-1)?.content : undefined;
  const retry = failed ? () => { void send(failed, turns.slice(0, -1)); } : undefined;
  return { turns, asking, error, send, retry };
}
