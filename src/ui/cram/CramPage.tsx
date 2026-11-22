import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, Text, View } from 'react-native';
import {
  cramLanguageOf, cramNotes, cramTag, daysUntil, fullDate, isAwaitingFinish, isRunning, lessonPhrases, meaningOf, MISSED_MAX, pendingRequests, practiceLabel, practiceOrder, practiceProgress,
  practiceSummary, preparedLines, talkScene, textWords, themeTopic, withoutCapture, withoutRequest, withoutTalk, wordState, type Cram, type CramTalk as Talk, type WordState,
} from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import type { Card, Note } from '../../core/types';
import type { Api, Language, QueuedNote } from '../../reader/api';
import { queuedFor } from '../../reader/noteQueue';
import { LANGUAGES } from '../../reader/languages';
import { rehearsalParams } from '../../reader/situations';
import type { AppRepo } from '../AppContext';
import { haptic } from '../haptics';
import { Button, Card as Box, Group, Help, Loading, NavRow, ProgressBar, Screen, SectionTitle } from '../kit';
import { readable, space, type, useTheme, type Colors } from '../theme';
import { capCramCards, saveCram, setCramTag, useCollection, useCramClock, useCrams } from '../useCrams';
import { Pill } from './CramBits';
import { RegisterPicker } from '../reader/RegisterPicker';
import type { RegisterLevel } from '../../reader/registerLevel';
import { CramListen } from './CramListen';
import { CramQuestions } from './CramQuestions';
import { CramTalk } from './CramTalk';
import { talkSizeMenu, useTalkSize } from './talkSize';
import { useMissedLately } from './useMissedLately';
import { leaveScreen } from '../leaveScreen';
import { DECKS_PATH } from '../tabPaths';

/** How many words the page lists before Show all. */
const WORDS_SHOWN = 8;

/**
 * A cram's page, the plan for the day: how practice is going and a Practice button that works any
 * time (on the lesson's day, Start the lesson leads instead); Talking points (folded, a tap opens one,
 * ⋯ edits its story or removes it); Words (Add, and a pill to bring in the words missed lately);
 * Questions about the language; Get ready (an audio lesson, a text, Rehearse); and Start the lesson.
 * Once finished, what was used and what was typed in the lesson.
 * Opening it also puts any of its reviews scheduled after the day on the day (`capCramCards`), and
 * says so if that fails.
 */
export function CramPage(props: {
  repo: AppRepo;
  id: string;
  readerApi: Api | null;
  /** The register Settings holds, for the picker's Default (undefined while unknown). */
  serverRegister?: RegisterLevel;
  onEditNote: (noteId: string, onClose: () => void) => void;
  onRead: (language: Language, words: string[]) => void;
  /** The note queue as the server last said it, so a card asked for shows whether it's ready, still being written or failed. */
  queued?: QueuedNote[];
  /** Opens a queued note in the note editor and takes it off the queue once saved; true when it was saved. */
  approve?: (note: QueuedNote) => Promise<boolean>;
  /** Asks Claude again for a note that couldn't be filled in. */
  retry?: (id: number) => Promise<void>;
}) {
  const { repo, id } = props;
  const c = useTheme();
  const router = useRouter();
  const { crams, loaded } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const notes = useMemo(() => (cram ? cramNotes(cram, collection.notes) : []), [cram, collection.notes]);
  const cardsOf = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const card of collection.cards) if (!card.retired) m.set(card.noteId, [...(m.get(card.noteId) ?? []), card]);
    return m;
  }, [collection.cards]);
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const inCram = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const missed = useMissedLately(repo, cram && !cram.finishedAt ? language : undefined).filter((nid) => !inCram.has(nid)).slice(0, MISSED_MAX);
  const [showAll, setShowAll] = useState(false);
  // The talking point opened on the page, by its title: one at a time.
  const [openTalk, setOpenTalk] = useState<string>();
  const [capProblem, setCapProblem] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const approving = useRef(false);

  // A cram deleted from its sheet: nothing left to show.
  useEffect(() => { if (loaded && !cram) leaveScreen(router, DECKS_PATH); }, [loaded, cram]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    capCramCards(repo).then(
      () => setCapProblem(undefined),
      (e) => setCapProblem(failureText(e, { what: "Couldn't make these words due by the cram's day.", next: 'Sync, then open the cram again.' })),
    );
  }, [repo, notes.length]);

  const [talkSize, chooseTalkSize] = useTalkSize();
  if (!cram || !collection.loaded) return <Screen title={cram?.name ?? ''}><Loading /></Screen>;

  const running = isRunning(cram, now, H);
  const over = isAwaitingFinish(cram, now, H);
  const days = daysUntil(cram, now, H);
  const ids = notes.map((n) => n.id);
  const solid = practiceProgress(cram, ids).solid.length;
  const words = language ? textWords(notes, collection.cards, language) : [];
  // What Rehearse works into Situations: the cram's words with their meanings, as an audio lesson takes them, shakiest first.
  const rehearsalWords = language ? lessonPhrases(practiceOrder(cram, notes), language) : [];
  const talks = cram.themes ?? [];
  const lessonDay = running && days === 0;
  const languageName = language ? LANGUAGES[language].name : undefined;
  const pending = pendingRequests(cram, notes);
  const listed = cram.finishedAt ? finishedNotes(cram, collection.notes) : notes;
  const shown = showAll ? listed : listed.slice(0, WORDS_SHOWN);
  const when = cram.finishedAt ? 'Finished' : over ? 'Over' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
  const go = (pathname: string, params: Record<string, string> = {}) => { haptic.tap(); router.push({ pathname: pathname as never, params: { id: cram.id, ...params } }); };
  const keep = (next: Cram, what: string) => saveCram(repo, next).catch((e) => setProblem(failureText(e, { what, next: 'Try again.' })));

  const addMissed = () => {
    haptic.tap();
    setProblem(undefined);
    setCramTag(repo, cram, missed, true).then(
      () => { collection.reload(); capCramCards(repo).catch(() => undefined); },
      (e) => setProblem(failureText(e, { what: "Couldn't add the words.", next: 'Try again.' })),
    );
  };
  const wordMenu = (note: Note) => {
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: headword(note), options: ['Edit note', 'Take out of this cram', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) props.onEditNote(note.id, collection.reload);
        if (i === 1) setCramTag(repo, cram, [note.id], false).then(collection.reload, (e) => setProblem(failureText(e, { what: "Couldn't take the word out.", next: 'Try again.' })));
      },
    );
  };
  // Saving in the note editor is the approval; the note then joins the cram (a new note in its language gets its tag).
  const approveRequest = async (note: QueuedNote) => {
    if (!props.approve || approving.current) return;
    approving.current = true;
    haptic.tap();
    setProblem(undefined);
    try {
      if (await props.approve(note)) { haptic.success(); collection.reload(); capCramCards(repo).catch(() => undefined); }
    } catch (e) {
      setProblem(failureText(e, { what: `Couldn't add ${note.entry}.`, next: 'Try again.' }));
    } finally {
      approving.current = false;
    }
  };
  const retryRequest = (note: QueuedNote) => {
    setProblem(undefined);
    props.retry?.(note.id).catch((e) => setProblem(failureText(e, { what: `Couldn't ask Claude again for ${note.entry}.`, next: 'Try again.' })));
  };
  const stopShowing = (text: string) => void keep(withoutRequest(cram, text), "Couldn't change the cram.");
  const requestMenu = (text: string, note?: QueuedNote) => {
    haptic.tap();
    if (note?.state === 'ready' && props.approve) { void approveRequest(note); return; }
    if (note?.state === 'failed' && props.approve) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: text, message: note.error || "Claude couldn't write a card for this.", options: ['Fill in by hand', ...(props.retry ? ['Try again'] : []), 'Stop showing it here', 'Cancel'], destructiveButtonIndex: props.retry ? 2 : 1, cancelButtonIndex: props.retry ? 3 : 2 },
        (i) => {
          if (i === 0) void approveRequest(note);
          else if (props.retry && i === 1) retryRequest(note);
          else if (i === (props.retry ? 2 : 1)) stopShowing(text);
        },
      );
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text, message: 'Claude is writing a card for this. It shows here as ready to review when it is done, and saving it adds it to the cram.', options: ['Stop showing it here', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => { if (i === 0) stopShowing(text); },
    );
  };
  const talkMenu = (talk: Talk) => {
    haptic.tap();
    // Editing has Read & Listen check the new story, so it's offered only while that's on.
    const editable = !!talk.story && !!props.readerApi;
    const options = [...(editable ? ['Edit the story'] : []), 'Remove', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: talk.title, options, destructiveButtonIndex: options.length - 2, cancelButtonIndex: options.length - 1 },
      (i) => {
        if (editable && i === 0) go('/cram-story', { title: talk.title });
        else if (i === options.length - 2) {
          Alert.alert(`Remove ${talk.title}?`, 'Its questions and story are removed from the cram. Its words stay.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => void keep(withoutTalk(cram, talk.title), "Couldn't remove the talking point.") },
          ]);
        }
      },
    );
  };
  const captureMenu = (text: string) => {
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text, options: ['Make a card', 'Remove', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) go('/cram-words', { q: text });
        if (i === 1) void keep(withoutCapture(cram, text), "Couldn't change the cram.");
      },
    );
  };

  const readerOff = 'Uses Read & Listen. Turn it on in Settings, Read & Listen.';
  return (
    <Screen
      title={cram.name}
      toolbar={(
        <Stack.Toolbar placement="right">
          {!cram.finishedAt && (cram.themes?.length || cram.questions?.length) ? talkSizeMenu(talkSize, chooseTalkSize) : null}
          <Stack.Toolbar.Button accessibilityLabel="Edit the cram" onPress={() => go('/cram-edit')}>Edit</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{[`${when}, ${fullDate(cram)}`, language ? LANGUAGES[language].name : undefined].filter(Boolean).join(' · ')}</Text>

        <Box>
          {cram.finishedAt ? (
            <Help>{finishedText(cram, crams)}</Help>
          ) : over ? (
            <>
              <Text style={{ ...type.headline, color: c.text }}>How did it go?</Text>
              <Help>Check off the words you used. The rest go into your next cram.</Help>
              <Button label="Check off words" onPress={() => go('/cram-lesson')} />
            </>
          ) : lessonDay ? (
            <>
              <Text style={{ ...type.headline, color: c.text }}>Lesson today</Text>
              <Help>{lessonContents(talks.length, cram.questions?.length ?? 0, ids.length, languageName)}</Help>
              <Button label="Start the lesson" onPress={() => go('/cram-lesson')} />
              {ids.length ? <Button variant="secondary" label={practiceLabel(cram, ids)} onPress={() => go('/cram-round')} /> : null}
              {ids.length ? <Help>{practiceSummary(cram, ids)}</Help> : null}
            </>
          ) : (
            <>
              <Text style={{ ...type.headline, color: c.text }}>{practiceSummary(cram, ids)}</Text>
              {cram.rounds.length && ids.length ? <ProgressBar value={solid / ids.length} label="Solid words" /> : null}
              {ids.length ? <Button label={practiceLabel(cram, ids)} onPress={() => go('/cram-round')} /> : null}
              <Help>{ids.length ? 'Words you missed come first. A word is solid after you get it right first try in two rounds in a row. Practicing here doesn\'t change your cards.' : 'Add words below to practice them.'}</Help>
            </>
          )}
        </Box>
        {capProblem ? <Text style={{ ...type.subhead, color: c.danger }}>{capProblem}</Text> : null}

        {!cram.finishedAt ? (
          <>
            <SectionTitle>{talks.length ? `Talking points · ${talks.length}` : 'Talking points'}</SectionTitle>
            {talks.map((talk) => (
              <CramTalk
                key={talk.title}
                repo={repo}
                talk={talk}
                language={language}
                size={talkSize}
                open={openTalk === talk.title}
                onToggle={() => setOpenTalk(openTalk === talk.title ? undefined : talk.title)}
                onMenu={() => talkMenu(talk)}
              />
            ))}
            <Group>
              <NavRow
                first
                icon={{ name: 'character.bubble', color: c.accent }}
                label="Talk it through in English"
                detail={!props.readerApi ? readerOff : !language ? 'Choose the cram\'s language first (Edit).' : `Say it in English first, then see how to say it in ${LANGUAGES[language].name}.`}
                disabled={!props.readerApi || !language}
                onPress={() => go('/cram-say')}
              />
              <NavRow
                icon={{ name: 'sparkles', color: c.accent }}
                label={talks.length ? 'More talking points' : 'Suggest talking points'}
                detail={!props.readerApi ? readerOff : !language ? 'Choose the cram\'s language first (Edit).' : themeTopic(cram) ? `Ways to talk about "${themeTopic(cram)}", with questions and words from your deck.` : 'Themes to talk about, with questions and words from your deck. The one you use names the cram.'}
                disabled={!props.readerApi || !language}
                onPress={() => go('/cram-themes')}
              />
            </Group>
          </>
        ) : null}

        <SectionTitle>{`Words · ${listed.length + pending.length}`}</SectionTitle>
        {!cram.finishedAt && missed.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            <Pill label={`Add ${missed.length} missed lately`} icon="plus" ink={c.danger} fill={c.dangerFill} onPress={addMissed} />
          </View>
        ) : null}
        <Group>
          {!cram.finishedAt ? <NavRow first icon={{ name: 'plus', color: c.accent }} label="Add a word" detail="Search your deck, or ask Claude for a card." onPress={() => go('/cram-words')} /> : null}
          {shown.map((note, i) => {
            const state = wordState(cram, note.id, (cardsOf.get(note.id) ?? []).every((x) => x.sched.state === 0));
            return (
              <NavRow
                key={note.id}
                first={i === 0 && !!cram.finishedAt}
                label={headword(note) || 'Untitled'}
                detail={meaningOf(note) || undefined}
                badge={badgeFor(cram, note.id, state, c)}
                onPress={() => (cram.finishedAt ? props.onEditNote(note.id, collection.reload) : wordMenu(note))}
              />
            );
          })}
          {pending.map((r, i) => {
            const note = queuedFor(props.queued ?? [], r.text);
            const badge = note?.state === 'ready' ? { text: 'Ready to review', color: c.accentInk, fill: c.accentFill }
              : note?.state === 'failed' ? { text: "Couldn't write", color: c.danger, fill: c.dangerFill }
              : { text: 'Being written', color: c.textSecondary, fill: c.fill };
            return <NavRow key={`asked-${r.text}`} first={!listed.length && !!cram.finishedAt && i === 0} label={r.text} detail={r.english} badge={badge} onPress={() => requestMenu(r.text, note)} />;
          })}
          {listed.length > WORDS_SHOWN ? (
            <NavRow label={showAll ? 'Show fewer' : `Show all ${listed.length}`} onPress={() => { haptic.tap(); setShowAll(!showAll); }} />
          ) : null}
        </Group>

        {cram.captured?.length ? (
          <>
            <SectionTitle>From the lesson</SectionTitle>
            <Group>
              {cram.captured.map((text, i) => <NavRow key={text} first={i === 0} label={text} detail="Tap to make a card." onPress={() => captureMenu(text)} />)}
            </Group>
            {props.readerApi && language && cram.captured.length > 1 ? (
              <Button variant="secondary" label={`Make cards for all ${cram.captured.length}`} onPress={() => go('/cram-cards')} />
            ) : null}
          </>
        ) : null}

        {!cram.finishedAt ? <CramQuestions repo={repo} cram={cram} language={language} size={talkSize} /> : null}

        {!cram.finishedAt ? (
          <>
            <SectionTitle>Get ready</SectionTitle>
            <Group>
              <CramListen repo={repo} api={props.readerApi} cram={cram} notes={notes} language={language} first />
              <NavRow
                icon={{ name: 'book', color: c.teal }}
                label="Read a text"
                detail={!props.readerApi ? readerOff : !language ? 'Needs words in a language Read & Listen supports.' : !words.length ? "Needs words you've studied at least once." : 'A short text using some of these words.'}
                disabled={!props.readerApi || !language || !words.length}
                onPress={() => { if (language) { haptic.tap(); props.onRead(language, words); } }}
              />
              <NavRow
                icon={{ name: 'bubble.left.and.bubble.right', color: c.accent }}
                label="Rehearse"
                detail={!props.readerApi ? readerOff : !language ? 'Needs words in a language Read & Listen supports.' : talks.length ? 'Your tutor asks about your talking points, and you try your answers.' : rehearsalWords.length ? `Talk it through with Claude, using ${rehearsalWords.length === 1 ? '1 word' : `${rehearsalWords.length} words`}.` : 'Talk it through with Claude.'}
                disabled={!props.readerApi || !language}
                onPress={() => { if (language) { haptic.tap(); router.push({ pathname: '/tool', params: rehearsalParams(language, talkScene(cram), rehearsalWords, cram.register, preparedLines(cram)) }); } }}
              />
            </Group>
            {props.readerApi ? (
              <Box>
                <RegisterPicker own={cram.register} settings={props.serverRegister} onChange={(register) => keep({ ...cram, register }, "Couldn't save how formal to be.")} />
              </Box>
            ) : null}

            {!lessonDay ? (
              <>
                <Button variant="secondary" label="Start the lesson" onPress={() => go('/cram-lesson')} />
                <Help>Your talking points, questions and words on one screen to check off as you go, and a place to jot down new words.</Help>
              </>
            ) : null}
          </>
        ) : null}

        {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
        {running ? <Help>{`These words come up for review by ${fullDate(cram).split(',')[0]}. After that, they go back to their usual schedule.`}</Help> : null}
        {!cram.finishedAt ? <Help>{`These words have the tag ${cramTag(cram)} in Anki, so Claude can find them too.`}</Help> : null}
      </ScrollView>
    </Screen>
  );
}

/** What the lesson day's card says the lesson has: "3 talking points, 1 question about Thai, 14 words." */
function lessonContents(talks: number, questions: number, words: number, languageName: string | undefined): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const about = languageName ?? 'the language';
  const parts = [
    ...(talks ? [count(talks, 'talking point', 'talking points')] : []),
    ...(questions ? [count(questions, `question about ${about}`, `questions about ${about}`)] : []),
    count(words, 'word', 'words'),
  ];
  return `${parts.join(', ')}.`;
}

/** What a finished cram's card says. */
function finishedText(cram: Cram, crams: Cram[]): string {
  const used = cram.used?.length ?? 0;
  const unused = cram.unused?.length ?? 0;
  const total = used + unused;
  const to = cram.carriedTo ? crams.find((x) => x.id === cram.carriedTo)?.name : undefined;
  const rest = !unused ? '' : to ? ` The ${unused === 1 ? 'other went' : `other ${unused} went`} into ${to}.` : ` Your next cram can take the ${unused === 1 ? 'other one' : `other ${unused}`}.`;
  return `${used} of ${total} ${total === 1 ? 'word' : 'words'} used.${rest}`;
}

/** A finished cram's words, which no longer carry its tag: the ones it kept, used first. */
function finishedNotes(cram: Cram, all: Note[]): Note[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  return [...(cram.used ?? []), ...(cram.unused ?? [])].map((id) => byId.get(id)).filter((n): n is Note => !!n);
}

function badgeFor(cram: Cram, noteId: string, state: WordState, c: Colors) {
  if (cram.finishedAt) return cram.used?.includes(noteId) ? { text: 'Used', color: c.goodInk, fill: c.goodFill } : { text: 'Not used', color: c.textSecondary, fill: c.fill };
  switch (state) {
    case 'missed': return { text: 'Missed', color: c.danger, fill: c.dangerFill };
    case 'got': return { text: 'Got it', color: c.goodInk, fill: c.goodFill };
    case 'carried': return { text: 'From last time', color: c.accentInk, fill: c.accentFill };
    case 'new': return { text: 'New', color: c.countNew, fill: c.countNewFill };
    default: return undefined;
  }
}
