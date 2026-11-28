import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { DeckLimits } from '../core/deckTree';
import { currentLimits, forecastRoots, limitDecks, passRate, type Forecast } from '../core/forecast';
import type { Answer, DayDue } from '../core/stats';
import type { Card, DeckParams, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Card as Box, Chip, Help, Icon, Tappable } from './kit';
import { Bars } from './StatsBars';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { useForecastBase, useForecastRun } from './useForecast';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const totalOf = (d: { scheduled: number; expected: number }) => d.scheduled + d.expected;

/** The reviews a new review limit step moves by. */
const REVIEW_STEP = 25;

type Edits = Map<string, Partial<DeckLimits>>;

/**
 * Stats' "Due in the next 30 days": the days' reviews as the forecast works them out
 * (src/core/forecast.ts), what is scheduled with what is expected on top of it, and a what-if
 * panel that tries other daily limits for each deck. Until the forecast is ready it draws what is
 * due on each day, which is what the chart showed before. Nothing here writes a setting.
 */
export function ForecastBox({ repo, data, answers, scope, decks, fallback, days }: {
  repo: Repo & AnkiLink;
  data: { notes: Note[]; cards: Card[]; params: Map<string, DeckParams>; now: Date; dayStartsAtHour: number };
  /** The answers of the decks in scope, which set how often a review is passed. */
  answers: Answer[];
  scope: string | null;
  decks: string[];
  /** What is due on each day as it stands, drawn until the forecast is ready. */
  fallback: { days: DayDue[]; overdue: number };
  days: number;
}) {
  const c = useTheme();
  const base = useForecastBase(repo, data);
  const key = scope ?? '*';
  const roots = useMemo(() => forecastRoots(scope, decks), [scope, decks]);
  const rows = useMemo(() => limitDecks(scope, decks), [scope, decks]);
  const rate = useMemo(() => passRate(answers, data.now, data.dayStartsAtHour), [answers, data.now, data.dayStartsAtHour]);
  const [edits, setEdits] = useState<Edits>(new Map());
  const [open, setOpen] = useState(false);
  // The limits tried belong to the decks shown: another scope starts clean.
  useEffect(() => { setEdits(new Map()); }, [scope]);

  const own = useForecastRun(base, { key, roots, passRate: rate, days });
  const edited = edits.size > 0;
  const trial = useForecastRun(base, { key, roots, passRate: rate, days, limits: edits, enabled: edited });
  const shown = edited ? trial.forecast ?? own.forecast : own.forecast;
  const before = edited ? own.forecast : undefined;
  const limits = useMemo(() => (base ? new Map(rows.map((d) => [d, currentLimits(base, d)])) : undefined), [base, rows]);

  const bars = shown
    ? shown.days.map((d, i) => ({ start: d.start, value: d.scheduled, expected: d.expected, before: before ? totalOf(before.days[i]) : undefined }))
    : fallback.days.map((d) => ({ start: d.start, value: d.due, expected: undefined as number | undefined, before: undefined as number | undefined }));
  const average = (f: Forecast) => Math.round(f.days.reduce((n, d) => n + totalOf(d), 0) / f.days.length);

  return (
    <>
      <Box>
        <Text style={{ ...type.headline, color: c.text }}>Due in the next {days} days</Text>
        <Bars
          bars={bars}
          describe={(d, i) => {
            const when = i === 0 ? 'Today' : dayLabel(d.start);
            if (!shown) return [when, `${plural(d.value, 'card', 'cards')} due`];
            const all = d.value + (d.expected ?? 0);
            const was = d.before !== undefined && d.before !== all ? ` (was ${d.before.toLocaleString()} in all)` : '';
            return [when, `${d.value.toLocaleString()} scheduled${d.expected ? `, about ${d.expected.toLocaleString()} more expected` : ''}${was}`];
          }}
          first="Today" last={`In ${days - 1} days`}
        />
        {shown ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.l, rowGap: space.xs }}>
            <Swatch color={c.chart} label="Scheduled" />
            <Swatch color={c.chart} faded label="Expected" />
            {before ? <Swatch color={c.text} line label="Before your changes" /> : null}
          </View>
        ) : null}
        <Help>
          {fallback.overdue ? `${plural(fallback.overdue, 'card is', 'cards are')} overdue. ` : ''}
          {shown
            ? `Tomorrow: about ${plural(totalOf(shown.days[1] ?? shown.days[0]), 'card', 'cards')}. About ${plural(average(shown), 'card', 'cards')} a day expected${before && average(before) !== average(shown) ? `, ${average(shown) < average(before) ? 'down' : 'up'} from ${average(before).toLocaleString()}` : ''}.`
            : `Tomorrow: ${plural(fallback.days[1]?.due ?? 0, 'card', 'cards')}. On average ${plural(Math.round(fallback.days.reduce((n, d) => n + d.due, 0) / days), 'card', 'cards')} a day.`}
        </Help>
        {shown ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Expected counts new cards and the reviews that come back, within your daily limits, assuming you pass {Math.round(rate * 100)}% of reviews, as you did in the last {days} days.
          </Text>
        ) : base ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Working out what to expect.</Text> : null}
      </Box>

      {limits ? (
        <Box>
          <Tappable
            onPress={() => { haptic.select(); setOpen((o) => !o); }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            hitSlop={{ top: space.m / 2, bottom: space.m / 2 }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TAP - space.m }}
          >
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>What if I change my limits?</Text>
            <Icon name={open ? 'chevron.up' : 'chevron.down'} size={16} color={c.textSecondary} weight="semibold" />
          </Tappable>
          {open ? <WhatIf scope={scope} rows={rows} current={limits} edits={edits} setEdits={setEdits} base={own.forecast} trial={edited ? trial : undefined} days={days} /> : null}
        </Box>
      ) : null}
    </>
  );
}

function Swatch({ color, faded, line, label }: { color: string; faded?: boolean; line?: boolean; label: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
      <View style={{ width: 12, height: line ? 2 : 10, borderRadius: line ? 0 : 3, backgroundColor: color, opacity: faded ? 0.4 : 1 }} />
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

function WhatIf({ scope, rows, current, edits, setEdits, base, trial, days }: {
  scope: string | null;
  rows: string[];
  current: Map<string, DeckLimits>;
  edits: Edits;
  setEdits: (e: Edits) => void;
  base: Forecast | undefined;
  /** The forecast with the edits, once run; undefined while nothing is changed. */
  trial: { forecast: Forecast | undefined; busy: boolean } | undefined;
  days: number;
}) {
  const c = useTheme();
  const valueOf = (deck: string, field: keyof DeckLimits) => edits.get(deck)?.[field] ?? current.get(deck)![field];
  const set = (deck: string, field: keyof DeckLimits, value: number, from: Edits = edits) => {
    const next = new Map(from);
    const entry = { ...next.get(deck) };
    if (value === current.get(deck)![field]) delete entry[field]; else entry[field] = value;
    if (Object.keys(entry).length) next.set(deck, entry); else next.delete(deck);
    return next;
  };
  const allNew = (to: (n: number) => number) => setEdits(rows.reduce((acc, d) => set(d, 'newPerDay', to(valueOf(d, 'newPerDay')), acc), edits));
  // The deck chosen, when its subdecks are listed under it, is the whole of it.
  const label = (deck: string) => (rows.length > 1 && deck === scope ? `${deck.split('::').at(-1)} (whole deck)` : deck.split('::').at(-1)!);

  const facts = (f: Forecast) => ({
    perDay: Math.round(f.days.reduce((n, d) => n + totalOf(d), 0) / f.days.length),
    started: f.newStarted,
    busiest: Math.max(...f.days.map(totalOf)),
    waiting: f.waiting,
  });
  const was = base ? facts(base) : undefined;
  const now = trial?.forecast ? facts(trial.forecast) : was;
  const line = (before: number | undefined, after: number | undefined) =>
    after === undefined ? '' : before !== undefined && before !== after ? `${after.toLocaleString()} (was ${before.toLocaleString()})` : after.toLocaleString();

  return (
    <View style={{ gap: space.l }}>
      <Help>Try other daily limits and watch the chart change. Nothing here is saved. Change the real limits in Deck options.</Help>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Chip label="Pause new cards" selected={false} onPress={() => allNew(() => 0)} />
        <Chip label="Half the new cards" selected={false} onPress={() => allNew((n) => Math.round(n / 2))} />
        <Chip label="Double new cards" selected={false} onPress={() => allNew((n) => n * 2)} />
        {edits.size ? <Chip label="Reset" selected={false} onPress={() => setEdits(new Map())} /> : null}
      </View>
      <View style={{ gap: space.l }}>
        {rows.map((deck) => (
          <View key={deck} style={{ gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }} numberOfLines={1}>{label(deck)}</Text>
            <View style={{ flexDirection: 'row', gap: space.m }}>
              <LimitStepper
                label="New per day" deck={label(deck)} value={valueOf(deck, 'newPerDay')} changed={edits.get(deck)?.newPerDay !== undefined}
                onStep={(by) => setEdits(set(deck, 'newPerDay', Math.max(0, valueOf(deck, 'newPerDay') + by)))} step={1}
              />
              <LimitStepper
                label="Reviews per day" deck={label(deck)} value={valueOf(deck, 'reviewsPerDay')} changed={edits.get(deck)?.reviewsPerDay !== undefined}
                onStep={(by) => setEdits(set(deck, 'reviewsPerDay', Math.max(0, valueOf(deck, 'reviewsPerDay') + by)))} step={REVIEW_STEP}
              />
            </View>
          </View>
        ))}
      </View>
      <Help>A deck never studies more than the deck above it allows, and its subdecks keep their own limits.</Help>
      {now ? (
        <View style={{ gap: space.xs }}>
          <SummaryRow label="Cards a day, on average" value={line(was?.perDay, now.perDay)} />
          <SummaryRow label={`New cards started in ${days} days`} value={line(was?.started, now.started)} />
          <SummaryRow label="Busiest day" value={line(was?.busiest, now.busiest)} />
          {now.waiting > 0 || (was?.waiting ?? 0) > 0 ? <SummaryRow label={`Reviews still waiting after ${days} days`} value={line(was?.waiting, now.waiting)} /> : null}
          {now.waiting > 0 ? <Help>The review limit is lower than the reviews coming due, so some are always left over.</Help> : null}
        </View>
      ) : null}
      {trial?.busy ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Updating the chart.</Text> : null}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
      <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{label}</Text>
      <Text style={{ ...type.subhead, color: c.text, fontVariant: ['tabular-nums'], textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function LimitStepper({ label, deck, value, changed, step, onStep }: { label: string; deck: string; value: number; changed: boolean; step: number; onStep: (by: number) => void }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: 2 }}>
        <StepButton icon="minus" label={`Lower ${label.toLowerCase()} for ${deck}`} disabled={value <= 0} onPress={() => onStep(-step)} />
        <Text style={{ ...type.headline, flex: 1, textAlign: 'center', color: changed ? c.accentInk : c.text, fontVariant: ['tabular-nums'] }} accessibilityLabel={`${label}: ${value}`}>{value}</Text>
        <StepButton icon="plus" label={`Raise ${label.toLowerCase()} for ${deck}`} disabled={false} onPress={() => onStep(step)} />
      </View>
    </View>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.select(); onPress(); }}
      disabled={disabled}
      hitSlop={space.xs / 2}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.92}
      restOpacity={disabled ? 0.4 : 1}
      style={{ width: MIN_TAP - space.xs, height: MIN_TAP - space.xs, borderRadius: radius.s + 2, ...smooth, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={18} color={c.text} weight="semibold" />
    </Tappable>
  );
}
