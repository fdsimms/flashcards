import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { candidateChips, noCandidatesText, type LessonWordCandidate } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Icon, Tappable } from '../kit';
import { radius, space, type, useTheme } from '../theme';
import { CandidateChips } from './CramBits';

/**
 * Make a card, in a cram's Add: what was typed (English, romanization or the language) is looked up
 * as Find word does for an audio lesson (`findWords`, which writes nothing), the words checked (any
 * number of them) are sent to the note queue for Claude to write (`ask`), and each note joins the
 * cram once it's approved, since a new note in the cram's language gets its tag. A second tap
 * while they are on their way does nothing, so a word isn't queued twice.
 */
export function CramAsk({ text, language, findWords, ask }: {
  text: string;
  language: Language;
  findWords: (text: string) => Promise<LessonWordCandidate[]>;
  /** Queues the words and keeps them on the cram as being written; says 'held' when they wait for a connection. */
  ask: (words: LessonWordCandidate[]) => Promise<'queued' | 'held' | undefined>;
}) {
  const c = useTheme();
  const name = LANGUAGES[language].name;
  const [candidates, setCandidates] = useState<{ for: string; list: LessonWordCandidate[] }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ for: string; words: string[]; held: boolean }>();
  // The words checked, by their text.
  const [checked, setChecked] = useState<{ for: string; texts: string[] }>();
  const [problem, setProblem] = useState<{ for: string; text: string }>();
  const working = useRef(false);
  const typed = text.trim();
  // What's shown belongs to what's typed now: an answer for an earlier search isn't.
  const list = candidates?.for === typed && candidates.list.length ? candidates.list : undefined;
  const sent = done?.for === typed ? done : undefined;
  const wrong = problem?.for === typed ? problem.text : undefined;
  const picked = list && checked?.for === typed ? list.filter((w) => checked.texts.includes(w.text)) : [];
  const toggle = (word: LessonWordCandidate) => {
    haptic.select();
    setChecked((p) => {
      const have = p?.for === typed ? p.texts : [];
      return { for: typed, texts: have.includes(word.text) ? have.filter((t) => t !== word.text) : [...have, word.text] };
    });
  };

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
  const make = () => run(async () => {
    haptic.tap();
    const how = await ask(picked);
    if (how) { haptic.success(); setDone({ for: typed, words: picked.map((w) => w.text), held: how === 'held' }); }
  });

  if (sent) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Icon name="checkmark.circle.fill" size={24} color={c.countDue} />
        <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>
          {sent.words.length === 1
            ? (sent.held
              ? `${sent.words[0]} will go to Claude once you're back online. Approve the card when it's ready and it joins the cram.`
              : `Claude is writing a card for ${sent.words[0]}. Approve it from the card on Today and it joins the cram.`)
            : (sent.held
              ? `${sent.words.length} words will go to Claude once you're back online. Approve the cards when they're ready and they join the cram.`
              : `Claude is writing ${sent.words.length} cards. Approve them from the card on Today and they join the cram.`)}
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
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{list.length === 1 ? 'Is this the one?' : 'Which ones? Check all you want.'}</Text>
          {list.map((cand) => {
            const on = picked.includes(cand);
            return (
              <Tappable
                key={cand.text}
                onPress={() => toggle(cand)}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: busy }}
                accessibilityLabel={[cand.text, cand.reading, cand.english, ...candidateChips(cand).map((x) => x.label)].filter(Boolean).join(', ')}
                scaleTo={0.98}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, backgroundColor: on ? c.accentFill : c.fill, borderRadius: radius.m, borderWidth: on ? 2 : 0, borderColor: c.accent, padding: space.m }}
              >
                <View style={{ paddingTop: 4 }}>
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.accent : c.textTertiary} weight="regular" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.title, color: c.text }}>{cand.text}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{[cand.reading, cand.english].filter(Boolean).join(' · ')}</Text>
                  <CandidateChips word={cand} />
                </View>
              </Tappable>
            );
          })}
          <Button label={picked.length === 1 ? 'Make 1 card' : `Make ${picked.length} cards`} onPress={() => void make()} busy={busy} disabled={!picked.length} />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>How common a word is and how it is said are Claude's judgment, not a dictionary's.</Text>
        </>
      )}
      {wrong ? <Text style={{ ...type.subhead, color: c.danger }}>{wrong}</Text> : null}
      {wrong && !list ? <Button variant="secondary" label="Try again" onPress={() => void find()} /> : null}
    </Card>
  );
}
