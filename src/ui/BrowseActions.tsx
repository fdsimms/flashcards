import React, { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Text, View } from 'react-native';
import { runBulkAction, undoBulkAction, type BulkUndo } from '../anki/browseActionService';
import type { NoteStore } from '../anki/noteService';
import { allSuspended, repositionProblem, tagsTyped, type BulkAction } from '../core/browseActions';
import { FLAG_NAMES } from '../core/cardState';
import { failureText, NOT_IN_ANKI } from '../core/failure';
import { parseDueDate } from '../core/reschedule';
import type { Card } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import { haptic } from './haptics';
import { Button, Field, SwitchRow } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Browse's Select mode actions (src/anki/browseActionService.ts): the bar's Suspend, Tags and More,
 * their sheets and prompts, Reposition's panel (which takes the bar's place while it's open), the line
 * saying what the last action did, and Undo for it until the selection changes. `reload` reads the
 * notes and cards again after a change. Browse calls `selectionChanged` when the learner picks or drops
 * a note, not when a note leaves the list: a note moved out of the deck being browsed still has its Undo.
 */
export function useBrowseActions({ repo, picked, cardsOf, dayStartsAtHour, reload }: {
  repo: NoteStore & Pick<AnkiLink, 'ankiDecks'>;
  /** The notes picked, in Browse's order. */
  picked: string[];
  /** A note's cards, as Browse has them. */
  cardsOf: (noteId: string) => Card[];
  dayStartsAtHour: number;
  reload: () => Promise<void>;
}) {
  const [status, setStatus] = useState<{ text: string; undo?: BulkUndo }>();
  const [repositioning, setRepositioning] = useState(false);
  const busy = useRef(false);
  // A new selection is a new subject: the last action's line and its Undo go.
  const selectionChanged = useCallback(() => { setStatus(undefined); setRepositioning(false); }, []);

  const run = useCallback(async (action: BulkAction) => {
    if (busy.current || !picked.length) return;
    busy.current = true;
    try {
      // After the answers Review has shown but not yet written (src/core/writeQueue.ts).
      await reviewWrites.idle();
      const r = await runBulkAction(repo, picked, action, { now: new Date(), dayStartsAtHour });
      haptic.success();
      setStatus({ text: r.summary, undo: r.undo });
      if (r.ankiError) Alert.alert("Couldn't save this change for Anki", failureText(r.ankiError, { next: NOT_IN_ANKI }));
    } catch (e) {
      Alert.alert("Couldn't change these notes", failureText(e, { next: 'Nothing was changed. Try again.' }));
    } finally {
      busy.current = false;
      await reload();
    }
  }, [repo, picked, dayStartsAtHour, reload]);

  const undo = useCallback(async () => {
    const u = status?.undo;
    if (!u || busy.current) return;
    busy.current = true;
    try {
      if (await undoBulkAction(repo, u)) {
        haptic.success();
        setStatus({ text: 'Undone.' });
      } else {
        Alert.alert("Couldn't undo this", 'It has already been synced to your Anki server. Undo only goes back to the last sync.');
      }
    } catch (e) {
      Alert.alert("Couldn't undo this", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
      await reload();
    }
  }, [repo, status, reload]);

  const sheet = (title: string, options: string[], onPick: (i: number) => void, o: { message?: string; destructive?: number } = {}) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message: o.message, options: [...options, 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: o.destructive },
      (i) => { if (i < options.length) onPick(i); },
    );
  };

  // The seven flags as Review offers them, and Remove flag while any of the cards has one.
  const flag = () => {
    const names = FLAG_NAMES.slice(1);
    const flagged = picked.flatMap(cardsOf).some((c) => !c.retired && c.flag);
    sheet('Flag these cards', [...names, ...(flagged ? ['Remove flag'] : [])], (i) => run({ kind: 'flag', flag: i < names.length ? i + 1 : 0 }));
  };

  const changeDeck = async () => {
    try {
      const [decks, params] = await Promise.all([repo.ankiDecks(), repo.listDeckParams()]);
      const names = [...new Set([...decks.map((d) => d.name), ...(await repo.listNotes()).map((n) => n.deck)])]
        .filter((d) => !params.get(d)?.filtered)
        .sort((a, b) => a.localeCompare(b));
      sheet(`Move ${picked.length === 1 ? '1 note' : `${picked.length} notes`} to`, names, (i) => run({ kind: 'deck', deck: names[i] }));
    } catch (e) {
      Alert.alert("Couldn't list your decks", failureText(e, { next: 'Try again.' }));
    }
  };

  const tags = () => sheet('Tags', ['Add tags…', 'Remove tags…'], (i) => {
    const adding = i === 0;
    Alert.prompt(adding ? 'Add tags' : 'Remove tags', 'Type the tags with spaces between them.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: adding ? 'Add' : 'Remove',
        onPress: (text?: string) => {
          const typed = tagsTyped(text ?? '');
          if (typed.length) run(adding ? { kind: 'addTags', tags: typed } : { kind: 'removeTags', tags: typed });
        },
      },
    ], 'plain-text', '', 'default');
  });

  const dueDate = () => Alert.prompt(
    'Set due date',
    'Days from today: 0 for today, 1 for tomorrow. A range like 3-7 picks a day in it at random for each card.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set',
        onPress: (text?: string) => {
          const spec = parseDueDate(text ?? '');
          if (!spec) { Alert.alert("That isn't a number of days", 'Enter a whole number of days, like 3, or a range like 3-7.'); return; }
          run({ kind: 'dueDate', spec });
        },
      },
    ],
    'plain-text', '', 'numbers-and-punctuation',
  );

  const forget = () => sheet('Forget these cards?', ['Forget', 'Forget and reset counts'], (i) => run({ kind: 'forget', resetCounts: i === 1 }), {
    message: 'They go back to being new cards, in their old places. Forget and reset counts also sets their review and lapse counts to zero.',
    destructive: 0,
  });

  const more = () => {
    haptic.tap();
    const actions: (() => void)[] = [() => run({ kind: 'bury' }), flag, changeDeck, dueDate, () => setRepositioning(true), forget];
    const cards = picked.flatMap(cardsOf).filter((c) => !c.retired).length;
    sheet(`${picked.length === 1 ? '1 note' : `${picked.length} notes`}, ${cards === 1 ? '1 card' : `${cards} cards`}`, ['Bury until tomorrow', 'Flag…', 'Change deck…', 'Set due date…', 'Reposition new cards…', 'Forget…'], (i) => actions[i](), { destructive: 5 });
  };

  const suspended = picked.length > 0 && allSuspended(picked.flatMap(cardsOf));
  const barActions = [
    suspended
      ? { label: 'Unsuspend', onPress: () => run({ kind: 'unsuspend' }) }
      : { label: 'Suspend', onPress: () => run({ kind: 'suspend' }) },
    { label: 'Tags', onPress: () => { haptic.tap(); tags(); } },
    { label: 'More', onPress: more },
  ];

  const repositionPanel = repositioning ? (
    <RepositionPanel
      notes={picked.length}
      onCancel={() => setRepositioning(false)}
      onReposition={(o) => { setRepositioning(false); run({ kind: 'reposition', ...o }); }}
    />
  ) : undefined;

  return { selectionChanged, barActions, status: status ? { text: status.text, onUndo: status.undo ? undo : undefined } : undefined, repositionPanel };
}

/** Anki's Reposition dialog, in the bar's place: where the new cards go, and how. */
function RepositionPanel({ notes, onCancel, onReposition }: {
  notes: number;
  onCancel: () => void;
  onReposition: (o: { start: number; step: number; randomize: boolean; shift: boolean }) => void;
}) {
  const c = useTheme();
  const [start, setStart] = useState('1');
  const [step, setStep] = useState('1');
  const [randomize, setRandomize] = useState(false);
  const [shift, setShift] = useState(false);
  const [problem, setProblem] = useState<string>();
  return (
    <View style={{ gap: space.s, paddingHorizontal: space.l, paddingTop: space.s }}>
      <Text style={{ ...type.subhead, color: c.textSecondary, fontWeight: '600' }}>{`Reposition the new cards of ${notes === 1 ? '1 note' : `${notes} notes`}`}</Text>
      <View style={{ flexDirection: 'row', gap: space.m }}>
        <View style={{ flex: 1 }}><Field label="Start position" value={start} onChangeText={(t) => { setStart(t); setProblem(undefined); }} keyboardType="number-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Step" value={step} onChangeText={(t) => { setStep(t); setProblem(undefined); }} keyboardType="number-pad" /></View>
      </View>
      <SwitchRow first label="Randomize order" value={randomize} onValueChange={setRandomize} />
      <SwitchRow label="Shift positions of existing cards" value={shift} onValueChange={setShift} />
      {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={onCancel} /></View>
        <View style={{ flex: 1 }}>
          <Button
            label="Reposition"
            onPress={() => {
              const p = repositionProblem(start, step);
              if (p) { setProblem(p); return; }
              onReposition({ start: Number(start), step: Number(step), randomize, shift });
            }}
          />
        </View>
      </View>
    </View>
  );
}
