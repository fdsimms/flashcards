import React, { useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { candidateChips, noCandidatesText, type LessonWordCandidate } from '../../core/lessonWords';
import type { Language, QueuedNote } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Icon, Tappable } from '../kit';
import { radius, smooth, space, type, useTheme } from '../theme';
import { CandidateChips } from './CramBits';
import { withThaiLineHeight } from '../../core/script';

/** What the card says once the words are sent: where they are, one sentence for one word or for several. */
function sentText(words: string[], held: boolean, approved: string[], ready: number): string {
  const one = words.length === 1;
  const added = words.filter((w) => approved.includes(w)).length;
  if (added === words.length) return one ? `The card for ${words[0]} is added to the cram.` : `All ${words.length} cards are added to the cram.`;
  if (ready) return one ? `Claude wrote a card for ${words[0]}. Approve it here and it joins the cram.` : `Claude wrote ${ready === 1 ? 'a card' : `${ready} cards`}. Approve ${ready === 1 ? 'it' : 'them'} here and ${ready === 1 ? 'it joins' : 'they join'} the cram.`;
  if (held) return one ? `Couldn't reach your server. ${words[0]} goes to Claude once it answers. Approve the card when it's ready and it joins the cram.` : `Couldn't reach your server. ${words.length} words go to Claude once it answers. Approve the cards when they're ready and they join the cram.`;
  return one ? `Claude is writing a card for ${words[0]}. Approve it here when it's ready and it joins the cram.` : `Claude is writing ${words.length} cards. Approve them here when they're ready and they join the cram.`;
}

/**
 * Make a card, in a cram's Add: what was typed (English, romanization or the language) is looked up
 * as Find word does for an audio lesson (`findWords`, which writes nothing), the words checked (any
 * number of them) are sent to the note queue for Claude to write (`ask`), and each note joins the
 * cram once it's approved, since a new note in the cram's language gets its tag. Once Claude has
 * written one, the card here opens it in the note editor (`approve`), so it's approved without
 * leaving the cram. A second tap while they are on their way does nothing, so a word isn't queued twice.
 *
 * With `add` instead of `ask` it adds phrases: the same lookup and the same checked choices, but each
 * checked word is kept on the cram as a phrase (cramPhrases.ts), with no card and nothing queued.
 */
export function CramAsk({ text, language, findWords, listed, ask, add, queued, approve }: {
  text: string;
  language: Language;
  findWords: (text: string) => Promise<LessonWordCandidate[]>;
  /** Drops the words the screen already lists elsewhere, so a word in the deck isn't offered as new. */
  listed?: (words: LessonWordCandidate[]) => LessonWordCandidate[];
  /** Queues the words and keeps them on the cram as being written; says 'held' when they wait for a connection. */
  ask?: (words: LessonWordCandidate[]) => Promise<'queued' | 'held' | undefined>;
  /** Keeps the words on the cram as phrases. Given, this is Add a phrase and `ask` is not used. */
  add?: (words: LessonWordCandidate[]) => Promise<void>;
  /** The note queue as the server last said it: the card shows a Review button here once Claude has written a word's card. */
  queued?: QueuedNote[];
  /** Opens the written card in the note editor; saving there is the approval. True when it was saved. */
  approve?: (note: QueuedNote) => Promise<boolean>;
}) {
  const c = useTheme();
  const name = LANGUAGES[language].name;
  const [candidates, setCandidates] = useState<{ for: string; list: LessonWordCandidate[] }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ for: string; words: string[]; held: boolean }>();
  // The words checked, by their text.
  const [checked, setChecked] = useState<{ for: string; texts: string[] }>();
  const [problem, setProblem] = useState<{ for: string; text: string }>();
  const [approved, setApproved] = useState<string[]>([]);
  const working = useRef(false);
  const typed = text.trim();
  // What's shown belongs to what's typed now: an answer for an earlier search isn't.
  const found = candidates?.for === typed && candidates.list.length ? candidates.list : undefined;
  const shown = found ? (listed ? listed(found) : found) : undefined;
  const list = shown?.length ? shown : undefined;
  // Everything Claude found is already listed under the field.
  const allListed = !!found && !list;
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
    // The choices and the Make cards button sit where the keyboard is; the field is a tap away.
    Keyboard.dismiss();
    const found = await findWords(typed);
    setCandidates({ for: typed, list: found });
    if (!found.length) setProblem({ for: typed, text: noCandidatesText(typed, name) });
  });
  const make = () => run(async () => {
    haptic.tap();
    if (add) {
      await add(picked);
      haptic.success();
      setDone({ for: typed, words: picked.map((w) => w.text), held: false });
      return;
    }
    const how = await ask?.(picked);
    if (how) { haptic.success(); setDone({ for: typed, words: picked.map((w) => w.text), held: how === 'held' }); }
  });

  // The cards Claude has written for the words sent, until each is saved in the note editor (the queue holds it till then).
  const ready = sent ? sent.words.flatMap((w) => (approved.includes(w) ? [] : queued?.filter((n) => n.state === 'ready' && n.entry === w).slice(0, 1) ?? [])) : [];
  const review = (note: QueuedNote) => run(async () => {
    haptic.tap();
    if (await approve?.(note)) { haptic.success(); setApproved((p) => [...p, note.entry]); }
  });

  if (sent && add) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Icon name="checkmark.circle.fill" size={24} color={c.countDue} />
          <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{sent.words.length === 1 ? `Added ${sent.words[0]} to the cram's phrases.` : `Added ${sent.words.length} phrases to the cram.`}</Text>
        </View>
      </Card>
    );
  }
  if (sent) {
    return (
      <Card style={{ gap: space.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Icon name="checkmark.circle.fill" size={24} color={c.countDue} />
          <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{sentText(sent.words, sent.held, approved, ready.length)}</Text>
        </View>
        {approve ? ready.map((n) => <Button key={n.entry} label={ready.length === 1 ? 'Review and add' : `Review and add ${n.entry}`} onPress={() => void review(n)} disabled={busy} />) : null}
        {wrong ? <Text style={{ ...type.subhead, color: c.danger }}>{wrong}</Text> : null}
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.s }}>
      {allListed ? (
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{`The ${name} for "${typed}" is already in your deck. Pick it below.`}</Text>
      ) : !list ? (
        <Tappable onPress={() => void find()} disabled={busy} accessibilityRole="button" accessibilityLabel={add ? `Add ${typed}` : `Make a card for ${typed}`} scaleTo={0.98} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Icon name="plus.circle.fill" size={26} color={c.accent} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...type.headline, color: c.text }}>{add ? `Add "${typed}"` : `Make a card for "${typed}"`}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{busy ? `Finding the ${name}` : add ? `Claude finds the ${name}.` : `Claude finds the ${name} and writes a card. Approve it and it joins the cram.`}</Text>
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
                // The border is always there, clear when not picked, so picking a card doesn't shift its text.
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, backgroundColor: on ? c.accentFill : c.fill, borderRadius: radius.m, ...smooth, borderWidth: 2, borderColor: on ? c.accent : 'transparent', padding: space.m - 2 }}
              >
                <View style={{ paddingTop: 4 }}>
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.accent : c.textTertiary} weight="regular" />
                </View>
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={{ ...withThaiLineHeight(type.title, cand.text), color: c.text }}>{cand.text}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{[cand.reading, cand.english].filter(Boolean).join(' · ')}</Text>
                  <CandidateChips word={cand} />
                </View>
              </Tappable>
            );
          })}
          <Button label={add ? (picked.length === 1 ? 'Add 1 phrase' : `Add ${picked.length} phrases`) : picked.length === 1 ? 'Make 1 card' : `Make ${picked.length} cards`} onPress={() => void make()} busy={busy} disabled={!picked.length} />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>How common a word is and how it is said are Claude's judgment, not a dictionary's.</Text>
        </>
      )}
      {wrong ? <Text style={{ ...type.subhead, color: c.danger }}>{wrong}</Text> : null}
      {wrong && !list ? <Button variant="secondary" label="Try again" onPress={() => void find()} /> : null}
    </Card>
  );
}
