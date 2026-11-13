import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { AGENT_FLAG, withFlagReason } from '../core/agentFlag';
import { cardTypeName } from '../core/cardInfo';
import { failureText } from '../core/failure';
import { canAddMnemonic, mnemonicQuestion, withMnemonic, type MnemonicQuestion } from '../core/leechHint';
import { notePreview } from '../core/noteEditing';
import { answersFrom, calendarStart, type Answer } from '../core/stats';
import { RECENT_DAYS, troubleCards, type TroubleMode, type TroubleRow } from '../core/trouble';
import type { Card, Note, NoteType } from '../core/types';
import type { AppRepo, NoteEditorResult, NoteEditorTarget } from './AppContext';
import { chooseAgentFlagReason } from './agentFlagSheet';
import { haptic } from './haptics';
import { Chip, Divider, Help, Icon, Loading, Screen, Segments } from './kit';
import { LeechHintSheet } from './LeechHintSheet';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

type Data = { notes: Note[]; cards: Card[]; answers: Answer[]; noteTypes: Map<string, NoteType>; now: Date; dayStartsAtHour: number };

const MODES: { value: TroubleMode; label: string }[] = [
  { value: 'most', label: 'Most missed' },
  { value: 'lately', label: 'Missed lately' },
];

/**
 * The cards being studied that are forgotten most (src/core/trouble.ts), opened from Stats: all
 * time, or over the last 30 study days. Tapping one offers what can be done about it: a memory
 * hint, a flag for an agent, the note editor, Card Info, or suspending it.
 */
export function TroubleCards({ repo, onEditNote, onCardInfo, suggestHints }: {
  repo: AppRepo;
  onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  onCardInfo: (cardId: string) => void;
  /** Read & Listen's hint ideas, while it's signed in. */
  suggestHints?: (q: MnemonicQuestion) => Promise<string[]>;
}) {
  const c = useTheme();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [reloads, setReloads] = useState(0);
  const [scope, setScope] = useState<string | null>(null);
  const [mode, setMode] = useState<TroubleMode>('most');
  const [hintFor, setHintFor] = useState<TroubleRow | null>(null);
  const busy = useRef(false);
  const store = repo as NoteStore;

  useEffect(() => {
    setError(undefined);
    (async () => {
      const now = new Date();
      const { dayStartsAtHour } = await repo.collectionSettings();
      const since = calendarStart(now, dayStartsAtHour, RECENT_DAYS);
      const [notes, cards, reviews, revlog, noteTypes] = await Promise.all([
        repo.listNotes(), repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since), repo.listNoteTypes(),
      ]);
      setData({ notes, cards, answers: answersFrom({ revlog, reviews, cards }), noteTypes, now, dayStartsAtHour });
    })().catch((e) => setError(failureText(e, { what: "Couldn't load your cards.", next: 'Try again.' })));
  }, [repo, reloads]);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  const tops = useMemo(() => [...new Set((data?.notes ?? []).map((n) => n.deck.split('::')[0]))].sort((a, b) => a.localeCompare(b)), [data]);
  const rows = useMemo(() => (data ? troubleCards({ ...data, deck: scope, mode }) : []), [data, scope, mode]);

  // Suspend or flag in Franki first, then in the kept collection, as Review's menu does.
  const setState = async (card: Card, change: Parameters<typeof setCardStates>[2]) => {
    if (!data) return;
    const { ankiError } = await setCardStates(repo, [card], change, new Date(), data.dayStartsAtHour);
    if (ankiError) Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: "It's made in Franki, but it won't reach Anki." }));
    haptic.success();
  };

  // One change at a time, and the list reloaded after it, since the row it was about may have moved or gone.
  const act = async (what: string, run: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await run();
    } catch (e) {
      Alert.alert(what, failureText(e, { next: 'Nothing was changed. Try again.' }));
    } finally {
      busy.current = false;
      reload();
    }
  };

  const flag = (row: TroubleRow) => chooseAgentFlagReason(row.card.flag === AGENT_FLAG, (reason) => act("Couldn't flag this card", async () => {
    if (!reason) return setState(row.card, (s) => ({ ...s, flag: 0 }));
    const { note } = row;
    await saveNote(store, { id: note.id, deck: note.deck, model: note.model, fields: note.fields, tags: withFlagReason(note.tags, reason) });
    await setState(row.card, (s) => ({ ...s, flag: AGENT_FLAG }));
  }));

  const open = (row: TroubleRow) => {
    const options = [
      ...(canAddMnemonic(row.note) ? ['Write a memory hint'] : []),
      'Flag for an agent', 'Edit note', 'Card info', 'Suspend card', 'Cancel',
    ];
    const at = (label: string) => options.indexOf(label);
    ActionSheetIOS.showActionSheetWithOptions({
      title: notePreview(row.note).front || undefined,
      options, cancelButtonIndex: at('Cancel'), destructiveButtonIndex: at('Suspend card'),
    }, (i) => {
      if (i === at('Write a memory hint')) setHintFor(row);
      if (i === at('Flag for an agent')) flag(row);
      if (i === at('Edit note')) onEditNote({ noteId: row.note.id }, (result) => { if (result) reload(); });
      if (i === at('Card info')) onCardInfo(row.card.id);
      if (i === at('Suspend card')) act("Couldn't suspend this card", () => setState(row.card, (s) => ({ ...s, suspended: true })));
    });
  };

  const hintNote = hintFor?.note;
  const question = hintNote ? mnemonicQuestion(hintNote) : undefined;
  const preview = hintNote ? notePreview(hintNote) : undefined;

  const summary = !data ? '' : rows.length === 0
    ? (mode === 'most' ? 'No card here has been forgotten yet.' : `Nothing here was answered Again in the last ${RECENT_DAYS} days.`)
    : mode === 'most'
      ? `${rows.length.toLocaleString()} ${rows.length === 1 ? 'card has' : 'cards have'} been forgotten at least once. Suspended cards aren't listed.`
      : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'card was' : 'cards were'} answered Again in the last ${RECENT_DAYS} days.`;

  return (
    <>
      {hintFor && hintNote && preview ? (
        <LeechHintSheet
          word={preview.front}
          gloss={preview.back}
          misses={hintFor.misses}
          suggest={suggestHints && question ? () => suggestHints(question) : undefined}
          onSkip={() => setHintFor(null)}
          onSave={async (hint) => {
            await saveNote(store, { id: hintNote.id, deck: hintNote.deck, model: hintNote.model, fields: withMnemonic(hintNote.fields, hint), tags: hintNote.tags });
            setHintFor(null);
            haptic.success();
            reload();
          }}
        />
      ) : null}
      <Screen title="Trouble cards">
        {!data ? (
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
            <Loading error={error} onRetry={reload} />
          </ScrollView>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.card.id}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l }}
            ListHeaderComponent={
              <View style={{ gap: space.m, paddingBottom: space.m }}>
                {tops.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
                    {[null, ...tops].map((d) => <Chip key={d ?? '*'} label={d ?? 'All decks'} selected={scope === d} onPress={() => setScope(d)} />)}
                  </ScrollView>
                ) : null}
                <Segments options={MODES} value={mode} onChange={setMode} />
                <Help>{summary}</Help>
              </View>
            }
            renderItem={({ item, index }) => (
              <Row row={item} mode={mode} noteType={data.noteTypes.get(item.note.model)} first={index === 0} last={index === rows.length - 1} onPress={() => open(item)} />
            )}
          />
        )}
      </Screen>
    </>
  );
}

/** One card, drawn as a row of the card the list sits on (the list stays virtualized), as Browse's rows are. */
function Row({ row, mode, noteType, first, last, onPress }: { row: TroubleRow; mode: TroubleMode; noteType: NoteType | undefined; first: boolean; last: boolean; onPress: () => void }) {
  const c = useTheme();
  const { front, back } = notePreview(row.note);
  const missed = mode === 'most'
    ? `Forgotten ${row.misses.toLocaleString()} ${row.misses === 1 ? 'time' : 'times'} in ${row.answers.toLocaleString()} ${row.answers === 1 ? 'answer' : 'answers'}`
    : `Again ${row.misses.toLocaleString()} of ${row.answers.toLocaleString()} ${row.answers === 1 ? 'review' : 'reviews'}`;
  const detail = [cardTypeName(row.card, noteType), missed, row.leech ? 'Leech' : '', row.card.flag === AGENT_FLAG ? 'Flagged for an agent' : ''].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[front || 'Empty note', back, detail].filter(Boolean).join(', ')}
      accessibilityHint="Shows what you can do about this card"
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : c.surface, ...smooth,
        borderColor: c.border, borderLeftWidth: hairline, borderRightWidth: hairline,
        borderTopWidth: first ? hairline : 0, borderBottomWidth: last ? hairline : 0,
        borderTopLeftRadius: first ? radius.l : 0, borderTopRightRadius: first ? radius.l : 0,
        borderBottomLeftRadius: last ? radius.l : 0, borderBottomRightRadius: last ? radius.l : 0,
      })}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...type.body, color: c.text }}>
          {front || '(empty)'}{back ? <Text style={{ color: c.textSecondary }}>{`  ${back}`}</Text> : null}
        </Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text>
      </View>
      {row.card.flag === AGENT_FLAG ? <Icon name="flag.fill" size={15} color={c.flags[AGENT_FLAG]} /> : null}
      <View style={{ minWidth: 32, alignItems: 'center', paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.dangerFill }}>
        <Text style={{ ...type.subhead, fontWeight: '600', color: c.danger, fontVariant: ['tabular-nums'] }}>{row.misses.toLocaleString()}</Text>
      </View>
    </Pressable>
  );
}
