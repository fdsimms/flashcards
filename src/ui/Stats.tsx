import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { studyDayStart } from '../core/day';
import { isInDeck } from '../core/deckTree';
import { paramsForDeck } from '../core/scheduler';
import { answersFrom, computeStats, durationText, MATURE_DAYS, percent, type Answer, type Rate } from '../core/stats';
import type { Card, DeckParams, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { Card as Box, Chip, Help, Screen } from './kit';
import { space, type, useTheme } from './theme';

/** How many study days the charts cover, back and ahead. */
const DAYS = 30;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Study statistics for the whole collection or one top-level deck with its subdecks: today, the
 * next 30 days' reviews, the last 30 days' answers, cards by stage, and retention. The numbers
 * come from src/core/stats.ts; this screen only gathers and shows them.
 */
export function Stats({ repo, onDone }: { repo: Repo & AnkiLink; onDone: () => void }) {
  const c = useTheme();
  const [data, setData] = useState<{ notes: Note[]; cards: Card[]; answers: Answer[]; params: Map<string, DeckParams>; now: Date }>();
  const [scope, setScope] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const now = new Date();
      // A day before the first one shown, so a card first answered then isn't counted new today.
      const since = studyDayStart(now, DAY_STARTS_AT_HOUR);
      since.setDate(since.getDate() - DAYS);
      const [notes, cards, reviews, revlog, params] = await Promise.all([
        repo.listNotes(), repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since), repo.listDeckParams(),
      ]);
      setData({ notes, cards, answers: answersFrom({ revlog, reviews, cards }), params, now });
    })();
  }, [repo]);

  const tops = useMemo(() => [...new Set((data?.notes ?? []).map((n) => n.deck.split('::')[0]))].sort((a, b) => a.localeCompare(b)), [data]);

  const stats = useMemo(() => {
    if (!data) return undefined;
    const deckOf = new Map(data.notes.map((n) => [n.id, n.deck]));
    const cards = scope === null ? data.cards : data.cards.filter((card) => isInDeck(deckOf.get(card.noteId) ?? '', scope));
    const ids = new Set(cards.map((card) => card.id));
    const answers = scope === null ? data.answers : data.answers.filter((a) => ids.has(a.cardId));
    return computeStats({ cards, answers, now: data.now, dayStartsAtHour: DAY_STARTS_AT_HOUR, days: DAYS });
  }, [data, scope]);

  const target = scope !== null && data ? paramsForDeck(scope, data.params)?.desiredRetention : undefined;

  return (
    <Screen onBack={onDone} title="Stats">
      {!stats ? null : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          {tops.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
              {[null, ...tops].map((d) => (
                <Chip key={d ?? '*'} label={d ?? 'All decks'} selected={scope === d} onPress={() => setScope(d)} />
              ))}
            </ScrollView>
          ) : null}

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Today</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.m }}>
              <Tile value={stats.today.answered.toLocaleString()} label={stats.today.answered === 1 ? 'answer' : 'answers'} />
              <Tile value={durationText(stats.today.takenMs)} label="studying" />
              <Tile value={stats.today.newCards.toLocaleString()} label="new cards" />
              <Tile value={stats.today.again.toLocaleString()} label="answered Again" />
            </View>
          </Box>

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Due in the next {DAYS} days</Text>
            <Bars
              days={stats.forecast.map((d) => ({ start: d.start, value: d.due }))}
              describe={(d, i) => [i === 0 ? 'Today' : dayLabel(d.start), `${plural(d.value, 'card', 'cards')} due`]}
              first="Today" last={`In ${DAYS - 1} days`}
            />
            <Help>
              {stats.overdue ? `${plural(stats.overdue, 'card is', 'cards are')} overdue. ` : ''}
              Tomorrow: {plural(stats.forecast[1]?.due ?? 0, 'card', 'cards')}. On average{' '}
              {plural(Math.round(stats.forecast.reduce((n, d) => n + d.due, 0) / DAYS), 'card', 'cards')} a day.
            </Help>
          </Box>

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Answers in the last {DAYS} days</Text>
            <Bars
              days={stats.past.map((d) => ({ start: d.start, value: d.learn + d.review + d.relearn, takenMs: d.takenMs }))}
              describe={(d, i, all) => [i === all - 1 ? 'Today' : dayLabel(d.start), `${plural(d.value, 'answer', 'answers')}${d.takenMs ? `, ${durationText(d.takenMs)}` : ''}`]}
              first={`${DAYS - 1} days ago`} last="Today"
            />
            <Help>{pastSummary(stats.past)}</Help>
          </Box>

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Cards</Text>
            <Row label="New" value={stats.counts.new} />
            <Row label="Learning" value={stats.counts.learning} />
            <Row label="Young" hint={`Reviews less than ${MATURE_DAYS} days apart`} value={stats.counts.young} />
            <Row label="Mature" hint={`Reviews ${MATURE_DAYS} days or more apart`} value={stats.counts.mature} />
            <Row label="Suspended" value={stats.counts.suspended} />
          </Box>

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Remembered</Text>
            <Help>Reviews not answered Again. Learning and relearning steps aren't counted.</Help>
            <Rated label="Last 7 days" rate={stats.retention.week} />
            <Rated label={`Last ${DAYS} days`} rate={stats.retention.month} />
            <Rated label={`Mature cards, last ${DAYS} days`} rate={stats.retention.matureMonth} />
            {target ? <Help>This deck aims for {Math.round(target * 100)}% (its desired retention in Anki).</Help> : null}
          </Box>
        </ScrollView>
      )}
    </Screen>
  );
}

/** Under a chart: the day tapped, or else the busiest one. */
function caption(picked: number | null, peakValue: number, [when, what]: [string, string]): string {
  if (picked !== null) return `${when}: ${what}`;
  return peakValue === 0 ? 'Nothing yet.' : `Busiest day: ${when} (${what})`;
}

function pastSummary(past: { learn: number; review: number; relearn: number; takenMs: number }[]): string {
  const total = past.reduce((n, d) => n + d.learn + d.review + d.relearn, 0);
  if (!total) return 'Nothing answered in this time.';
  const studied = past.filter((d) => d.learn + d.review + d.relearn > 0).length;
  const sum = (k: 'learn' | 'review' | 'relearn') => past.reduce((n, d) => n + d[k], 0);
  const time = past.reduce((n, d) => n + d.takenMs, 0);
  return `Studied on ${studied} of ${past.length} days: ${plural(total, 'answer', 'answers')}`
    + `${time ? ` in ${durationText(time)}` : ''} (${plural(sum('review'), 'review', 'reviews')}, `
    + `${sum('learn').toLocaleString()} learning, ${sum('relearn').toLocaleString()} relearning).`;
}

function Tile({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <View style={{ width: '50%', gap: 2 }}>
      <Text style={{ ...type.title, color: c.text }}>{value}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

function Row({ label, hint, value }: { label: string; hint?: string; value: number }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
      </View>
      <Text style={{ ...type.body, color: c.text, fontVariant: ['tabular-nums'] }}>{value.toLocaleString()}</Text>
    </View>
  );
}

function Rated({ label, rate }: { label: string; rate: Rate }) {
  const c = useTheme();
  const p = percent(rate);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
      <Text style={{ ...type.body, color: c.text, flex: 1 }}>{label}</Text>
      <Text style={{ ...type.body, color: c.text, fontVariant: ['tabular-nums'] }}>
        {p === null ? 'No reviews' : `${p}%`}
      </Text>
      {p === null ? null : <Text style={{ ...type.footnote, color: c.textSecondary }}>of {rate.total.toLocaleString()}</Text>}
    </View>
  );
}

const CHART_HEIGHT = 120;

/**
 * One value per day as columns from a shared baseline. Tap a column (or move VoiceOver to it)
 * to read its day and value; until then the line under the chart reads the peak.
 */
function Bars<T extends { start: Date; value: number }>({ days, describe, first, last }: {
  days: T[];
  /** The day, and what it holds. */
  describe: (d: T, index: number, count: number) => [when: string, what: string];
  first: string;
  last: string;
}) {
  const c = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.value));
  const peak = days.reduce((best, d, i) => (d.value > days[best].value ? i : best), 0);
  const shown = picked ?? peak;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{max.toLocaleString()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2, borderBottomWidth: 1, borderColor: c.border }}>
        {days.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => setPicked(i === picked ? null : i)}
            accessibilityRole="button"
            accessibilityLabel={describe(d, i, days.length).join(': ')}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
          >
            {d.value > 0 ? (
              <View style={{
                width: '100%', maxWidth: 24, height: Math.max(2, (d.value / max) * CHART_HEIGHT),
                backgroundColor: c.chart, borderTopLeftRadius: 4, borderTopRightRadius: 4,
                opacity: picked === null || picked === i ? 1 : 0.35,
              }} />
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.caption, color: c.textTertiary }}>{first}</Text>
        <Text style={{ ...type.caption, color: c.textTertiary }}>{last}</Text>
      </View>
      <Text style={{ ...type.subhead, color: c.text }}>{caption(picked, days[peak].value, describe(days[shown], shown, days.length))}</Text>
    </View>
  );
}
