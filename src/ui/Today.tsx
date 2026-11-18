import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, RefreshControl, ScrollView, Text, View } from 'react-native';
import { deckListTotals, todayDeckRows, type DeckRow } from '../core/deckTree';
import { todayProgress } from '../core/todaySummary';
import { DeckRowLink, groupByTopLevel, NoDecksCard, WarningBanner, type DeckAction } from './DeckList';
import { Group, Icon, Screen } from './kit';
import { CountingText, Reveal, useReduceMotion } from './motion';
import type { StudiedToday } from './useTodaySummary';
import { NoteQueueCard, useNoteQueueBanner } from './NoteQueueBanner';
import { SyncingPill, useSyncTap, type SyncProp } from './syncTap';
import { hairline, radius, readable, smooth, space, type, useTheme } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { VacationCard, useVacationBanner } from './vacationNotice';
import { useVocabReady, VocabReadyCard } from './VocabReadyBanner';

/** What's waiting across every deck, or that nothing is: the first thing Today says. */
function TodaySummary({ due, fresh, studied }: { due: number; fresh: number; studied?: StudiedToday }) {
  const c = useTheme();
  const caughtUp = due + fresh === 0;
  // The figures tick to a new value (back from studying, after a sync) rather than jumping.
  const figure = (value: number, label: string, color: string) => (
    <View style={{ flex: 1, gap: 2, alignItems: 'center' }}>
      <CountingText value={value} style={{ ...type.largeTitle, color: value ? color : c.textDim, fontVariant: ['tabular-nums'] }} />
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={[caughtUp ? 'All caught up. Nothing is due today.' : `Today: ${due} due, ${fresh} new`, studied?.text].filter(Boolean).join('. ')}
      style={{
        gap: space.m, padding: space.l, borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      {caughtUp ? (
        <>
          <Icon name="checkmark.circle.fill" size={34} color={c.countDue} weight="regular" effect="bounce" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, color: c.text }}>All caught up</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Nothing is due today.</Text>
          </View>
        </>
      ) : (
        <>
          {figure(due, 'due today', c.countDue)}
          {figure(fresh, 'new today', c.countNew)}
        </>
      )}
      </View>
      {studied ? (
        <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
          <ProgressTrack value={todayProgress(studied.answered, due + fresh)} />
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
            {studied.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * How far through today's cards: answers given against those plus what's still waiting
 * (`todayProgress`). Grows to a new value rather than jumping, at once when Reduce Motion is on.
 */
function ProgressTrack({ value }: { value: number }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    if (reduce) { v.setValue(value); return undefined; }
    const run = Animated.timing(v, { toValue: value, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View accessible={false} style={{ height: space.s, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', borderRadius: radius.pill, backgroundColor: c.countDue, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

/**
 * The Today tab, the first screen: only what's for today. The day's count, what needs doing (a
 * note queue, the vocabulary check, vacation, a failed sync, an overdue backup), today's extras,
 * and the decks with something due or new (`todayDeckRows`), each family under its top-level deck
 * as on Decks. A deck with nothing today isn't shown; Decks has them all. Counts are the deck
 * list's own rows, so the two tabs never disagree.
 */
export function Today(props: {
  decks: DeckRow[];
  /** False until the first load of the decks has finished, so an empty list isn't "No decks yet" yet. */
  loaded?: boolean;
  /**
   * False while the pieces Today is made of (the counts, "Studied today", the extras, grammar due)
   * are still arriving: a spinner shows, then everything fades in together (useTodayReady), so the
   * screen doesn't shift as each one lands. Undefined shows it at once.
   */
  ready?: boolean;
  /** "Studied today: ..." under the due and new figures (useTodaySummary), once something has been answered today. */
  studied?: StudiedToday;
  /** Today's extras (DailyExtras.tsx), under the day's count. */
  extrasStrip?: React.ReactNode;
  /** When the last backup was made, and whether another is due (`backupStatus`); warned about only when overdue, and not while sync is on. */
  backup?: { text: string; overdue: boolean };
  /** Why the decks couldn't be loaded, when the last try failed: the rows shown may be out of date. */
  loadProblem?: { text: string; onRetry: () => void };
  /** Present when sync is on. */
  sync?: SyncProp;
  onImport: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onOptions: (deck: string) => void;
  onDeckMenu: (deck: string) => void;
  onDeckAction: (deck: string, action: DeckAction) => void;
  /** Decks whose subdecks are hidden: the same as on Decks (Anki's own collapsed state). */
  collapsed?: Set<string>;
  onToggleCollapsed?: (deck: string) => void;
  /** WaniKani (WaniKaniDeck.tsx): counted in today's totals, and shown only with reviews or lessons waiting. */
  extra?: { node: React.ReactNode; due: number; fresh: number; refresh: () => Promise<unknown> };
}) {
  const c = useTheme();
  const header = useHeaderInset();
  const { banner: vocabReady } = useVocabReady();
  const noteQueue = useNoteQueueBanner();
  const vacation = useVacationBanner();
  const groups = useMemo(() => groupByTopLevel(todayDeckRows(props.decks, props.collapsed ?? new Set())), [props.decks, props.collapsed]);
  // The deck whose row is slid open on its Options action; one at a time.
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  const syncTap = useSyncTap(props.sync, props.extra?.refresh);
  const totals = useMemo(() => {
    const t = deckListTotals(props.decks);
    return props.extra ? { due: t.due + props.extra.due, fresh: t.fresh + props.extra.fresh } : t;
  }, [props.decks, props.extra?.due, props.extra?.fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const backup = props.sync ? undefined : props.backup;
  const anyDecks = props.decks.length > 0 || !!props.extra;
  const ready = props.ready !== false;
  return (
    <Screen
      title="Today"
      toolbar={
        <Stack.Toolbar placement="right">
          {props.sync ? (
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" selected={syncTap.busy} tintColor={syncTap.busy ? c.accent : undefined} accessibilityLabel={syncTap.busy ? 'Syncing' : 'Sync now'} onPress={syncTap.tap} />
          ) : null}
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Today settings" onPress={props.onSettings} />
        </Stack.Toolbar>
      }
    >
      <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1 }}>
      {!ready ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={readable}
        // Always mounted, as on Decks: one added once sync's settings load moved the content down.
        refreshControl={<RefreshControl refreshing={syncTap.pulling} onRefresh={syncTap.pull} tintColor={c.textSecondary} />}
      >
        {/* One fade for the whole screen, the first time it shows (ready). */}
        <Reveal style={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
          {/* Today's count first; what needs doing sits under it, so a few banners never push it off the screen. */}
          {anyDecks ? <TodaySummary due={totals.due} fresh={totals.fresh} studied={props.studied} /> : null}
          {backup?.overdue ? (
            <WarningBanner title={backup.text} detail="Everything is stored only on this iPhone." action="Tap to back up now" hint="Opens Backup" onPress={props.onBackup} />
          ) : null}
          {props.loadProblem ? (
            <WarningBanner title="Couldn't load your decks" detail={props.loadProblem.text} action="Tap to try again" hint="Loads the decks again" onPress={props.loadProblem.onRetry} />
          ) : null}
          {props.sync?.failed ? (
            // A failed sync sits right under today's count, where it can't be scrolled past; a tap tries again.
            <WarningBanner title="Sync didn't finish" detail={props.sync.status} action="Tap to try again" hint="Syncs now" onPress={syncTap.tap} />
          ) : null}
          {vocabReady ? <VocabReadyCard banner={vocabReady} /> : null}
          {noteQueue ? <NoteQueueCard banner={noteQueue} /> : null}
          {vacation ? <VacationCard notice={vacation} due={totals.due} /> : null}
          {props.extrasStrip}
          {!anyDecks ? (props.loaded === false ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : <NoDecksCard onImport={props.onImport} />) : (
            groups.map((g) => (
              <Group key={g[0].deck}>
                {g.map((row, i) => (
                  <DeckRowLink
                    key={row.deck}
                    row={row}
                    first={i === 0}
                    toggleSlot={!!props.onToggleCollapsed}
                    open={openDeck === row.deck}
                    onOpenChange={(open) => setOpenDeck(open ? row.deck : null)}
                    onOptions={() => props.onOptions(row.deck)}
                    onMenu={() => props.onDeckMenu(row.deck)}
                    onAction={(action) => props.onDeckAction(row.deck, action)}
                    onToggle={props.onToggleCollapsed ? () => props.onToggleCollapsed!(row.deck) : undefined}
                  />
                ))}
              </Group>
            ))
          )}
          {props.extra && props.extra.due + props.extra.fresh > 0 ? props.extra.node : null}
        </Reveal>
      </ScrollView>
      )}
      {syncTap.shown ? <SyncingPill top={header.top} /> : null}
      </View>
    </Screen>
  );
}
