import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { cardHistory } from '../anki/cardHistory';
import { cardInfo, type CardInfo as Info, type HistoryEntry } from '../core/cardInfo';
import { FLAG_NAMES } from '../core/cardState';
import { studyDayStart } from '../core/day';
import { cardHomeDeck } from '../core/deckTree';
import { paramsForDeck } from '../core/scheduler';
import { durationText } from '../core/stats';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { ErrorNote, Group, Screen, SectionTitle } from './kit';
import { hairline, space, type, useTheme } from './theme';

const RATINGS = ['', 'Again', 'Hard', 'Good', 'Easy'];
const date = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTime = (d: Date) => d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const deckName = (d: string) => d.split('::').join(' › ');

/** A label and its value, one row of a `Group`. */
function InfoRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: 'row', justifyContent: 'space-between', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l,
        borderTopWidth: first ? 0 : hairline, borderTopColor: c.border,
      }}
    >
      <Text style={{ ...type.body, color: c.textSecondary }}>{label}</Text>
      <Text style={{ ...type.body, color: c.text, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/** What Card Info lists about the card, in Anki's order. */
function rows(info: Info, dayStartsAtHour: number): [string, string][] {
  const out: [string, string][] = [];
  if (info.added) out.push(['Added', date(info.added)]);
  if (info.firstAnswer) out.push(['First review', date(info.firstAnswer)]);
  if (info.latestAnswer) out.push(['Latest review', date(info.latestAnswer)]);
  const due = info.due;
  if (info.suspended) out.push(['Due', 'Suspended']);
  else if (due.kind === 'new') out.push(['Position', due.position !== undefined ? `New #${due.position}` : 'New']);
  // A review is due for its whole study day; a step is due at its time.
  else out.push(['Due', due.kind === 'review' ? date(studyDayStart(due.at, dayStartsAtHour)) : dateTime(due.at)]);
  if (info.interval !== undefined) out.push(['Interval', `${info.interval.toLocaleString()} ${info.interval === 1 ? 'day' : 'days'}`]);
  if (info.stability !== undefined) out.push(['Stability', `${info.stability < 10 ? info.stability.toFixed(1) : Math.round(info.stability).toLocaleString()} days`]);
  if (info.difficulty !== undefined) out.push(['Difficulty', `${info.difficulty}%`]);
  if (info.retrievability !== undefined) out.push(['Retrievability', `${info.retrievability}%`]);
  out.push(['Reviews', info.reviews.toLocaleString()], ['Lapses', info.lapses.toLocaleString()]);
  if (info.averageMs !== undefined) out.push(['Average time', info.averageMs < 60_000 ? `${Math.round(info.averageMs / 1000)} s` : durationText(info.averageMs)]);
  if (info.totalMs !== undefined) out.push(['Total time', info.totalMs < 60_000 ? `${Math.round(info.totalMs / 1000)} s` : durationText(info.totalMs)]);
  if (info.flag) out.push(['Flag', FLAG_NAMES[info.flag]]);
  out.push(['Card type', info.cardType], ['Note type', info.noteType], ['Deck', deckName(info.deck)]);
  if (info.homeDeck) out.push(['Home deck', deckName(info.homeDeck)]);
  return out;
}

function HistoryRow({ entry, first }: { entry: HistoryEntry; first?: boolean }) {
  const c = useTheme();
  const what = entry.rating > 0 ? `${entry.kind}: ${RATINGS[entry.rating]}` : entry.interval ? 'Due date set' : 'Reset to new';
  const detail = [entry.interval, entry.timeMs !== undefined ? `${Math.round(entry.timeMs / 1000)} s` : undefined].filter(Boolean).join(' · ');
  return (
    <View
      accessible
      accessibilityLabel={`${dateTime(entry.at)}. ${what}${detail ? `. ${detail}` : ''}`}
      style={{ paddingVertical: space.m, paddingHorizontal: space.l, gap: 2, borderTopWidth: first ? 0 : hairline, borderTopColor: c.border }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
        <Text style={{ ...type.body, color: entry.rating === 1 ? c.again : c.text }}>{what}</Text>
        {detail ? <Text style={{ ...type.body, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{dateTime(entry.at)}</Text>
    </View>
  );
}

/**
 * Anki's Card Info for one card: its schedule, its FSRS memory, and its history. The numbers come
 * from src/core/cardInfo.ts; this screen gathers and shows them.
 */
export function CardInfo({ repo, cardId }: { repo: Repo & AnkiLink; cardId: string }) {
  const c = useTheme();
  const [data, setData] = useState<{ info: Info; history: HistoryEntry[]; dayStartsAtHour: number } | null>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const now = new Date();
        const card = (await repo.listCards()).find((x) => x.id === cardId);
        const note = card && (await repo.getNote(card.noteId));
        if (!card || !note) { if (live) setData(null); return; }
        const [noteTypes, params, cs, history] = await Promise.all([
          repo.listNoteTypes(), repo.listDeckParams(), repo.collectionSettings(), cardHistory(repo, card),
        ]);
        const weights = paramsForDeck(cardHomeDeck(card, note.deck), params)?.weights ?? [];
        if (live) setData({ info: cardInfo(card, note, noteTypes.get(note.model), history, { now, weights }), history, dayStartsAtHour: cs.dayStartsAtHour });
      } catch (e) {
        if (live) setError(`Couldn't read this card's history. ${e instanceof Error ? e.message : ''}`.trim());
      }
    })();
    return () => { live = false; };
  }, [repo, cardId]);

  return (
    <Screen title="Card info" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {data === null ? <Text style={{ ...type.body, color: c.textSecondary }}>This card isn't in Franki any more.</Text> : null}
        {data ? (
          <>
            <Group>
              {rows(data.info, data.dayStartsAtHour).map(([label, value], i) => <InfoRow key={label} label={label} value={value} first={i === 0} />)}
            </Group>
            <SectionTitle>History</SectionTitle>
            {data.history.length ? (
              <Group accessibilityRole="list">
                {data.history.map((h, i) => <HistoryRow key={`${h.at.getTime()}:${i}`} entry={h} first={i === 0} />)}
              </Group>
            ) : (
              <Text style={{ ...type.body, color: c.textSecondary }}>Not studied yet.</Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
