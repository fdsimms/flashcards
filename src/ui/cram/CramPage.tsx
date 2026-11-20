import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import {
  cramLanguage, cramNotes, cramTag, daysUntil, fullDate, isAwaitingFinish, isRunning, lessonPhrases, meaningOf, roundStatus, textWords, wordState, type Cram, type WordState,
} from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import type { Card, Note } from '../../core/types';
import type { Api, Language } from '../../reader/api';
import { rehearsalParams } from '../../reader/situations';
import { haptic } from '../haptics';
import { Button, Card as Box, Group, Help, Loading, NavRow, Screen, SectionTitle } from '../kit';
import { readable, space, type, useTheme, type Colors } from '../theme';
import { capCramCards, setCramTag, useCollection, useCramClock, useCrams } from '../useCrams';
import { CramListen } from './CramListen';
import { CramTalk } from './CramTalk';
import { leaveScreen } from '../leaveScreen';
import { DECKS_PATH } from '../tabPaths';

/**
 * A cram's page: its day and rounds, what else there is before the day (a text, an audio lesson,
 * the checklist for the day itself), and its words, each with how it went last round. A word is
 * tapped to edit its note or take it out; Add words opens the picker. Opening it also puts any of
 * its reviews scheduled after the day on the day (`capCramCards`), and says so if that fails.
 */
export function CramPage(props: {
  repo: NoteStore;
  id: string;
  readerApi: Api | null;
  onEditNote: (noteId: string, onClose: () => void) => void;
  onRead: (language: Language, words: string[]) => void;
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
  const [capProblem, setCapProblem] = useState<string>();
  const [problem, setProblem] = useState<string>();

  // A cram deleted from its sheet: nothing left to show.
  useEffect(() => { if (loaded && !cram) leaveScreen(router, DECKS_PATH); }, [loaded, cram]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    capCramCards(repo).then(
      () => setCapProblem(undefined),
      (e) => setCapProblem(failureText(e, { what: "Couldn't move these words' reviews to the cram's day.", next: 'Sync, then open the cram again.' })),
    );
  }, [repo, notes.length]);

  if (!cram || !collection.loaded) return <Screen title={cram?.name ?? ''}><Loading /></Screen>;

  const running = isRunning(cram, now, H);
  const over = isAwaitingFinish(cram, now, H);
  const status = roundStatus(cram, now, H);
  const language = cram.language ?? cramLanguage(notes);
  const words = language ? textWords(notes, collection.cards, language) : [];
  // What Rehearse works into Situations: the cram's words with their meanings, as an audio lesson takes them.
  const rehearsalWords = language ? lessonPhrases(notes, language) : [];
  const days = daysUntil(cram, now, H);

  const wordMenu = (note: Note) => {
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: headword(note), options: ['Edit note', 'Take out of this cram', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) props.onEditNote(note.id, collection.reload);
        if (i === 1) {
          setCramTag(repo, cram, [note.id], false).then(collection.reload, (e) => setProblem(failureText(e, { what: "Couldn't take the word out.", next: 'Try again.' })));
        }
      },
    );
  };

  return (
    <Screen
      title={cram.name}
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel="Edit the cram" onPress={() => { haptic.tap(); router.push({ pathname: '/cram-edit', params: { id: cram.id } }); }}>Edit</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Box>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{fullDate(cram)}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{cram.finishedAt ? 'Finished' : over ? 'Over' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</Text>
          </View>
          {cram.finishedAt ? (
            <Help>{finishedText(cram, crams)}</Help>
          ) : over ? (
            <>
              <Help>The day is over. Check off the words you used; the rest go into your next cram.</Help>
              <Button label="Check off words" onPress={() => { haptic.tap(); router.push({ pathname: '/cram-used', params: { id: cram.id } }); }} />
            </>
          ) : (
            <>
              <Help>{notes.length ? status.text : 'Add words to start a round.'}</Help>
              {status.ready && status.action && notes.length ? (
                <Button label={status.action} onPress={() => { haptic.tap(); router.push({ pathname: '/cram-round', params: { id: cram.id } }); }} />
              ) : null}
            </>
          )}
        </Box>
        {capProblem ? <Text style={{ ...type.subhead, color: c.danger }}>{capProblem}</Text> : null}
        {cram.theme ? <CramTalk repo={repo} talk={cram.theme} language={language} /> : null}
        {!cram.finishedAt ? (
          <>
            <SectionTitle>Before the day</SectionTitle>
            <Group>
              <NavRow
                first
                icon={{ name: 'book', color: c.teal }}
                label="Read a text"
                detail={!props.readerApi ? 'Off. Turn on Read & Listen in Settings to use it.' : !language ? 'Needs words in a language Read & Listen writes in.' : !words.length ? "Needs words you've studied at least once." : 'A short text using some of these words.'}
                disabled={!props.readerApi || !language || !words.length}
                onPress={() => { if (language) { haptic.tap(); props.onRead(language, words); } }}
              />
              <CramListen repo={repo} api={props.readerApi} cram={cram} notes={notes} language={language} />
              <NavRow
                icon={{ name: 'bubble.left.and.bubble.right', color: c.accent }}
                label="Rehearse"
                detail={!props.readerApi ? 'Off. Turn on Read & Listen in Settings to use it.' : !language ? 'Needs words in a language Read & Listen plays.' : rehearsalWords.length ? `Talk it through with Claude, using ${rehearsalWords.length === 1 ? '1 word' : `${rehearsalWords.length} words`}.` : 'Talk it through with Claude.'}
                disabled={!props.readerApi || !language}
                onPress={() => { if (language) { haptic.tap(); router.push({ pathname: '/tool', params: rehearsalParams(language, cram.theme?.title ?? cram.name, rehearsalWords) }); } }}
              />
            </Group>
            <SectionTitle>On the day</SectionTitle>
            <Group>
              <NavRow
                first
                icon={{ name: 'checklist', color: c.orange }}
                label="Check off words"
                detail="Check off the words as you use them."
                onPress={() => { haptic.tap(); router.push({ pathname: '/cram-used', params: { id: cram.id } }); }}
              />
            </Group>
          </>
        ) : null}
        <SectionTitle>{notes.length === 1 ? '1 word' : `${notes.length} words`}</SectionTitle>
        <Group>
          {!cram.finishedAt ? (
            <NavRow first icon={{ name: 'plus', color: c.accent }} label="Add words" detail={running ? 'Pick from your decks.' : undefined} onPress={() => { haptic.tap(); router.push({ pathname: '/cram-words', params: { id: cram.id } }); }} />
          ) : null}
          {(cram.finishedAt ? finishedNotes(cram, collection.notes) : notes).map((note, i) => {
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
        </Group>
        {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
        {running ? <Help>{`Until ${fullDate(cram).split(',')[0]}, reviews of these words are due no later than that day. Afterwards they keep their usual schedule.`}</Help> : null}
        {!cram.finishedAt ? <Help>{`In Anki, and for Claude, these words carry the tag ${cramTag(cram)}.`}</Help> : null}
      </ScrollView>
    </Screen>
  );
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
