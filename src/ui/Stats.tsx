import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { cardHomeDeck, isInDeck } from '../core/deckTree';
import { failureText } from '../core/failure';
import { paramsForDeck } from '../core/scheduler';
import {
  answerButtons, answerCalendar, answersByHour, answersFrom, calendarStart, computeStats, durationText, intervalGroups, intervalText,
  MATURE_DAYS, retentionGapLine, retentionTarget, STATS_RANGES, subdeckLevels, trueRetention, type Answer,
} from '../core/stats';
import type { Card, DeckParams, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { WANIKANI_SCOPE } from '../wanikani/log';
import { Card as Box, Chip, Group, Help, Loading, NavRow, Screen, Segments } from './kit';
import { AnswerButtonsBox, HoursBox, RetentionTable } from './StatsAnswers';
import { Bars } from './StatsBars';
import { AnswerCalendar } from './StatsCalendar';
import { space, type, useTheme, readable } from './theme';

/** How many study days the charts cover, back and ahead. */
const DAYS = 30;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Study statistics for the whole collection or one deck with its subdecks (a top-level deck, then
 * a row of chips per level of subdecks under it): today, the next 30 days' reviews, the last 30
 * days' answers, a year's calendar of answers with the streak, cards by stage and by interval, the
 * answer buttons and the hours of the day over a range chosen, and retention by period. The numbers come from src/core/stats.ts; this screen only
 * gathers and shows them, and opens Trouble cards. WaniKani's answers given here (`wanikani`, src/wanikani/log.ts) count
 * with the rest and have a chip of their own; its items aren't cards, so the charts about cards
 * leave them out.
 */
export function Stats({ repo, wanikani = [], onTrouble }: { repo: Repo & AnkiLink; wanikani?: Answer[]; onTrouble: () => void }) {
  const c = useTheme();
  const [data, setData] = useState<{ notes: Note[]; cards: Card[]; answers: Answer[]; params: Map<string, DeckParams>; now: Date; dayStartsAtHour: number }>();
  const [scope, setScope] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(STATS_RANGES[0].days);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(undefined);
    (async () => {
      // After the answers Review has shown but not yet written (src/core/writeQueue.ts).
      await reviewWrites.idle();
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

  const decks = useMemo(() => [...new Set((data?.notes ?? []).map((n) => n.deck))], [data]);
  const tops = useMemo(() => [
    ...[...new Set(decks.map((d) => d.split('::')[0]))].sort((a, b) => a.localeCompare(b)),
    ...(wanikani.length ? [WANIKANI_SCOPE] : []),
  ], [decks, wanikani.length]);
  const onWaniKani = scope === WANIKANI_SCOPE;
  const levels = useMemo(() => (onWaniKani ? [] : subdeckLevels(decks, scope)), [decks, scope, onWaniKani]);
  const range = STATS_RANGES.find((r) => r.days === rangeDays) ?? STATS_RANGES[0];

  const stats = useMemo(() => {
    if (!data) return undefined;
    const deckOf = new Map(data.notes.map((n) => [n.id, n.deck]));
    const cards = scope === null ? data.cards : scope === WANIKANI_SCOPE ? [] : data.cards.filter((card) => isInDeck(cardHomeDeck(card, deckOf.get(card.noteId) ?? ''), scope));
    const ids = new Set(cards.map((card) => card.id));
    const answers = scope === null ? [...data.answers, ...wanikani] : scope === WANIKANI_SCOPE ? wanikani : data.answers.filter((a) => ids.has(a.cardId));
    const { now, dayStartsAtHour } = data;
    // Within the year of answers loaded (`calendarStart`), which no range goes past.
    const since = calendarStart(now, dayStartsAtHour, rangeDays);
    return {
      ...computeStats({ cards, answers, now, dayStartsAtHour, days: DAYS }),
      calendar: answerCalendar({ answers, now, dayStartsAtHour }),
      intervals: intervalGroups(cards),
      buttons: answerButtons({ answers, since }),
      hours: answersByHour({ answers, since, dayStartsAtHour }),
      retention: trueRetention({ answers, now, dayStartsAtHour }),
      // Each review against its own deck's desired retention: a deck's subdecks can each have their own.
      aim: scope === WANIKANI_SCOPE ? null : retentionTarget({
        answers, since: calendarStart(now, dayStartsAtHour, 30),
        targetOf: (() => {
          const home = new Map(cards.map((card) => [card.id, cardHomeDeck(card, deckOf.get(card.noteId) ?? '')]));
          return (cardId: string) => { const d = home.get(cardId); return d === undefined ? undefined : paramsForDeck(d, data.params)?.desiredRetention; };
        })(),
      }),
    };
  }, [data, scope, wanikani, rangeDays]);

  const target = scope !== null && data ? paramsForDeck(scope, data.params)?.desiredRetention : undefined;

  return (
    <Screen title="Stats">
      {!stats ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, flexGrow: 1 }}>
          <Loading error={error} onRetry={() => setAttempt((n) => n + 1)} />
        </ScrollView>
      ) : null}
      {!stats ? null : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          {tops.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
              {[null, ...tops].map((d) => (
                <Chip key={d ?? '*'} label={d ?? 'All decks'} selected={d === null ? scope === null : scope !== null && (scope === d || (d !== WANIKANI_SCOPE && isInDeck(scope, d)))} onPress={() => setScope(d)} />
              ))}
            </ScrollView>
          ) : null}
          {levels.map(({ parent, children }) => (
            <ScrollView key={parent} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
              <Chip label={`All of ${parent.split('::').pop()}`} selected={scope === parent} onPress={() => setScope(parent)} />
              {children.map((d) => (
                <Chip key={d} label={d.split('::').pop()!} selected={scope !== null && isInDeck(scope, d)} onPress={() => setScope(d)} />
              ))}
            </ScrollView>
          ))}

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

          <Segments
            options={STATS_RANGES.map((r) => ({ value: r.days, label: r.label }))}
            value={range.days}
            onChange={setRangeDays}
          />
          {onWaniKani ? null : <AnswerButtonsBox buttons={stats.buttons} range={range.label.replace(/^1 /, '')} />}
          <HoursBox hours={stats.hours} range={range.label.replace(/^1 /, '')} />

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
            <RetentionTable rows={stats.retention} splitByAge={!onWaniKani} />
            {stats.aim?.mixed
              ? <Help>The decks here aim for {Math.round(stats.aim.target * 100)}% on average over the last 30 days (their desired retention in Anki).</Help>
              : target ? <Help>This deck aims for {Math.round(target * 100)}% (its desired retention in Anki).</Help> : null}
            {stats.aim && retentionGapLine(stats.aim) ? <Help>{retentionGapLine(stats.aim)}</Help> : null}
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
