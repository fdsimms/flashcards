import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { noCandidatesText, type LessonWordCandidate } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Icon, Tappable } from '../kit';
import { radius, space, type, useTheme } from '../theme';

/**
 * Make a card, in a cram's Add: what was typed (English, romanization or the language) is looked up
 * as Find word does for an audio lesson (`findWords`, which writes nothing), the word picked is sent
 * to the note queue for Claude to write (`ask`), and the note joins the cram once it's approved,
 * since a new note in the cram's language gets its tag. A second tap while one is on its way does
 * nothing, so a word isn't queued twice.
 */
export function CramAsk({ text, language, findWords, ask }: {
  text: string;
  language: Language;
  findWords: (text: string) => Promise<LessonWordCandidate[]>;
  /** Queues the word and keeps it on the cram as being written; says 'held' when it waits for a connection. */
  ask: (word: LessonWordCandidate) => Promise<'queued' | 'held' | undefined>;
}) {
  const c = useTheme();
  const name = LANGUAGES[language].name;
  const [candidates, setCandidates] = useState<{ for: string; list: LessonWordCandidate[] }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ for: string; word: string; held: boolean }>();
  const [problem, setProblem] = useState<{ for: string; text: string }>();
  const working = useRef(false);
  const typed = text.trim();
  // What's shown belongs to what's typed now: an answer for an earlier search isn't.
  const list = candidates?.for === typed && candidates.list.length ? candidates.list : undefined;
  const sent = done?.for === typed ? done : undefined;
  const wrong = problem?.for === typed ? problem.text : undefined;

  const run = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await fn();
    } catch (e) {
      setProblem({ for: typed, text: failureText(e, { next: 'Try again.' }) });
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const find = () => run(async () => {
    haptic.tap();
    const found = await findWords(typed);
    setCandidates({ for: typed, list: found });
    if (!found.length) setProblem({ for: typed, text: noCandidatesText(typed, name) });
  });
  const pick = (word: LessonWordCandidate) => run(async () => {
    haptic.tap();
    const how = await ask(word);
    if (how) { haptic.success(); setDone({ for: typed, word: word.text, held: how === 'held' }); }
  });

  if (sent) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Icon name="checkmark.circle.fill" size={24} color={c.countDue} />
        <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>
          {sent.held
            ? `${sent.word} will go to Claude once you're back online. Approve the card when it's ready and it joins the cram.`
            : `Claude is writing a card for ${sent.word}. Approve it from the card on Today and it joins the cram.`}
        </Text>
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.s }}>
      {!list ? (
        <Tappable onPress={() => void find()} disabled={busy} accessibilityRole="button" accessibilityLabel={`Make a card for ${typed}`} scaleTo={0.98} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Icon name="plus.circle.fill" size={26} color={c.accent} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, color: c.text }}>{`Make a card for "${typed}"`}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{busy ? `Finding the ${name}` : `Claude finds the ${name} and writes the card. It joins this cram once you approve it.`}</Text>
          </View>
        </Tappable>
      ) : (
        <>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{list.length === 1 ? 'Is this the one?' : 'Which one?'}</Text>
          {list.map((cand) => (
            <Tappable
              key={cand.text}
              onPress={() => void pick(cand)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Make a card for ${[cand.text, cand.reading, cand.english].filter(Boolean).join(', ')}`}
              scaleTo={0.98}
              style={{ gap: 2, backgroundColor: c.fill, borderRadius: radius.m, padding: space.m }}
            >
              <Text style={{ ...type.title, color: c.text }}>{cand.text}</Text>
              <Text style={{ ...type.subhead, color: c.textSecondary }}>{[cand.reading, cand.english].filter(Boolean).join(' · ')}</Text>
            </Tappable>
          ))}
          {busy ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Sending it to Claude</Text> : null}
        </>
      )}
      {wrong ? <Text style={{ ...type.subhead, color: c.danger }}>{wrong}</Text> : null}
      {wrong && !list ? <Button variant="secondary" label="Try again" onPress={() => void find()} /> : null}
    </Card>
  );
}
