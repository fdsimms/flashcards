import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { cardHomeDeck, isInDeck } from '../core/deckTree';
import { failureText } from '../core/failure';
import { paramsForDeck } from '../core/scheduler';
import {
  answerCalendar, answersFrom, calendarStart, computeStats, durationText, intervalGroups, intervalText, MATURE_DAYS, percent,
  type Answer, type Rate,
} from '../core/stats';
import type { Card, DeckParams, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { WANIKANI_SCOPE } from '../wanikani/log';
import { Card as Box, Chip, Group, Help, Loading, NavRow, Screen } from './kit';
import { haptic } from './haptics';
import { AnswerCalendar } from './StatsCalendar';
import { hairline, space, type, useTheme } from './theme';

/** How many study days the charts cover, back and ahead. */
const DAYS = 30;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Study statistics for the whole collection or one top-level deck with its subdecks: today, the
 * next 30 days' reviews, the last 30 days' answers, a year's calendar of answers, cards by stage
 * and by interval, and retention. The numbers come from src/core/stats.ts; this screen only
 * gathers and shows them, and opens Trouble cards. WaniKani's answers given here (`wanikani`, src/wanikani/log.ts) count
 * with the rest and have a chip of their own; its items aren't cards, so the charts about cards
 * leave them out.
 */
export function Stats({ repo, wanikani = [], onTrouble }: { repo: Repo & AnkiLink; wanikani?: Answer[]; onTrouble: () => void }) {
  const c = useTheme();
  const [data, setData] = useState<{ notes: Note[]; cards: Card[]; answers: Answer[]; params: Map<string, DeckParams>; now: Date; dayStartsAtHour: number }>();
  const [scope, setScope] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(undefined);
    (async () => {
      const now = new Date();
      const { dayStartsAtHour } = await repo.collectionSettings();
      // The calendar's year, which also reaches back past the first day the 30-day charts show,
      // so a card first answered before then isn't counted new today.
      const since = calendarStart(now, dayStartsAtHour);
      const [notes, cards, reviews, revlog, params] = await Promise.all([
        repo.listNotes(), repo.listCards(), repo.listReviews(since), repo.ankiReviewLog(since), repo.listDeckParams(),
      ]);
      setData({ notes, cards, answers: answersFrom({ revlog, reviews, cards }), params, now, dayStartsAtHour });
    })().catch((e) => setError(failureText(e, { what: "Couldn't load the stats.", next: 'Try again.' })));
  }, [repo, attempt]);

  const tops = useMemo(() => [
    ...[...new Set((data?.notes ?? []).map((n) => n.deck.split('::')[0]))].sort((a, b) => a.localeCompare(b)),
    ...(wanikani.length ? [WANIKANI_SCOPE] : []),
  ], [data, wanikani.length]);
  const onWaniKani = scope === WANIKANI_SCOPE;

  const stats = useMemo(() => {
    if (!data) return undefined;
    const deckOf = new Map(data.notes.map((n) => [n.id, n.deck]));
    const cards = scope === null ? data.cards : scope === WANIKANI_SCOPE ? [] : data.cards.filter((card) => isInDeck(cardHomeDeck(card, deckOf.get(card.noteId) ?? ''), scope));
    const ids = new Set(cards.map((card) => card.id));
    const answers = scope === null ? [...data.answers, ...wanikani] : scope === WANIKANI_SCOPE ? wanikani : data.answers.filter((a) => ids.has(a.cardId));
    const { now, dayStartsAtHour } = data;
    return {
      ...computeStats({ cards, answers, now, dayStartsAtHour, days: DAYS }),
      calendar: answerCalendar({ answers, now, dayStartsAtHour }),
      intervals: intervalGroups(cards),
    };
  }, [data, scope, wanikani]);

  const target = scope !== null && data ? paramsForDeck(scope, data.params)?.desiredRetention : undefined;

  return (
    <Screen title="Stats">
      {!stats ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
          <Loading error={error} onRetry={() => setAttempt((n) => n + 1)} />
        </ScrollView>
      ) : null}
      {!stats ? null : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
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
              <Tile value={stats.today.newCards.toLocaleString()} label={onWaniKani ? 'lessons' : 'new cards'} />
              <Tile value={stats.today.again.toLocaleString()} label={onWaniKani ? 'missed along the way' : 'answered Again'} />
            </View>
          </Box>

          {onWaniKani ? (
            <Help>WaniKani answers given in Franki. Answers given on wanikani.com aren't counted here.</Help>
          ) : null}

          {onWaniKani ? null : (
          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Due in the next {DAYS} days</Text>
            <Bars
              bars={stats.forecast.map((d) => ({ start: d.start, value: d.due }))}
              describe={(d, i) => [i === 0 ? 'Today' : dayLabel(d.start), `${plural(d.value, 'card', 'cards')} due`]}
              first="Today" last={`In ${DAYS - 1} days`}
            />
            <Help>
              {stats.overdue ? `${plural(stats.overdue, 'card is', 'cards are')} overdue. ` : ''}
              Tomorrow: {plural(stats.forecast[1]?.due ?? 0, 'card', 'cards')}. On average{' '}
              {plural(Math.round(stats.forecast.reduce((n, d) => n + d.due, 0) / DAYS), 'card', 'cards')} a day.
            </Help>
          </Box>
          )}

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Answers in the last {DAYS} days</Text>
            <Bars
              bars={stats.past.map((d) => ({ start: d.start, value: d.learn + d.review + d.relearn, takenMs: d.takenMs }))}
              describe={(d, i, all) => [i === all - 1 ? 'Today' : dayLabel(d.start), `${plural(d.value, 'answer', 'answers')}${d.takenMs ? `, ${durationText(d.takenMs)}` : ''}`]}
              first={`${DAYS - 1} days ago`} last="Today"
            />
            <Help>{pastSummary(stats.past)}</Help>
          </Box>

          <AnswerCalendar calendar={stats.calendar} />

          {onWaniKani ? null : (
          <>
          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Cards</Text>
            <Row label="New" value={stats.counts.new} />
            <Row label="Learning" value={stats.counts.learning} />
            <Row label="Young" hint={`Reviews less than ${MATURE_DAYS} days apart`} value={stats.counts.young} />
            <Row label="Mature" hint={`Reviews ${MATURE_DAYS} days or more apart`} value={stats.counts.mature} />
            <Row label="Suspended" value={stats.counts.suspended} />
          </Box>

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Review intervals</Text>
            <Bars
              bars={stats.intervals.groups.map((g) => ({ label: g.label, value: g.cards }))}
              describe={(g) => [g.label, plural(g.value, 'card', 'cards')]}
              first="1 day" last="Over 2 years" peak="Most cards"
            />
            <Help>
              {stats.intervals.total
                ? `Cards in review, by the time from their last review to their next. On average ${intervalText(stats.intervals.average)}; `
                  + `the longest is ${intervalText(stats.intervals.longest)}. Suspended cards aren't counted.`
                : 'No cards in review yet.'}
            </Help>
          </Box>
          </>
          )}

          <Box>
            <Text style={{ ...type.headline, color: c.text }}>Remembered</Text>
            <Help>
              {onWaniKani
                ? 'Reviews answered right the first time, meaning and reading. Lessons aren\'t counted.'
                : "Reviews not answered Again. Learning and relearning steps aren't counted."}
            </Help>
            <Rated label="Last 7 days" rate={stats.retention.week} />
            <Rated label={`Last ${DAYS} days`} rate={stats.retention.month} />
            {onWaniKani ? null : <Rated label={`Mature cards, last ${DAYS} days`} rate={stats.retention.matureMonth} />}
            {target ? <Help>This deck aims for {Math.round(target * 100)}% (its desired retention in Anki).</Help> : null}
          </Box>

          {onWaniKani ? null : (
            <Group>
              <NavRow first icon={{ name: 'exclamationmark.triangle.fill', color: c.again }} label="Trouble cards" detail="The cards you forget most, and what to do about them" onPress={onTrouble} />
            </Group>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/** Under a chart: the bar tapped, or else the highest one. */
function caption(picked: number | null, peakValue: number, [when, what]: [string, string], peak: string): string {
  if (picked !== null) return `${when}: ${what}`;
  return peakValue === 0 ? 'Nothing yet.' : `${peak}: ${when} (${what})`;
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
      <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
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
 * One value per day (or per group) as columns from a shared baseline. Tap a column (or move
 * VoiceOver to it) to read its day and value; until then the line under the chart reads the peak.
 */
function Bars<T extends { value: number }>({ bars, describe, first, last, peak: peakLabel = 'Busiest day' }: {
  bars: T[];
  /** The day (or group), and what it holds. */
  describe: (d: T, index: number, count: number) => [when: string, what: string];
  first: string;
  last: string;
  /** What the line under the chart calls the highest column. */
  peak?: string;
}) {
  const c = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((d) => d.value));
  const peak = bars.reduce((best, d, i) => (d.value > bars[best].value ? i : best), 0);
  const shown = picked ?? peak;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{max.toLocaleString()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2, borderBottomWidth: hairline, borderColor: c.border }}>
        {bars.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => { haptic.select(); setPicked(i === picked ? null : i); }}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === i }}
            accessibilityLabel={describe(d, i, bars.length).join(': ')}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
          >
            {d.value > 0 ? (
              <View style={{
                width: '100%', maxWidth: 24, height: Math.max(2, (d.value / max) * CHART_HEIGHT),
                backgroundColor: c.chart, borderTopLeftRadius: 5, borderTopRightRadius: 5,
                opacity: picked === null || picked === i ? 1 : 0.35,
              }} />
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.caption, color: c.textSecondary }}>{first}</Text>
        <Text style={{ ...type.caption, color: c.textSecondary }}>{last}</Text>
      </View>
      <Text style={{ ...type.subhead, color: c.text }}>{caption(picked, bars[peak].value, describe(bars[shown], shown, bars.length), peakLabel)}</Text>
    </View>
  );
}
