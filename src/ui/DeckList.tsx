import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { siblingStep, type DeckMove } from '../core/deckOrder';
import { deckListTotals, isInDeck, shownDeckRows, type DeckRow } from '../core/deckTree';
import { useDeckDrag } from './DeckDrag';
import { DISCLOSURE, ROW_PAD, WELL_EDGE, WELL_INSET } from './deckLayout';
import { haptic } from './haptics';
import { Button, Card, Group, Icon, NavRow, Screen, SwipeToReveal, Tappable } from './kit';
import { useReduceMotion } from './motion';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

type ShownRow = DeckRow & { hasSubdecks: boolean; collapsed: boolean };

/** Rows grouped under their top-level deck, so each family of decks sits in one card. */
function groupByTopLevel(rows: ShownRow[]): ShownRow[][] {
  const groups: ShownRow[][] = [];
  for (const r of rows) {
    if (r.depth === 0 || !groups.length) groups.push([r]);
    else groups[groups.length - 1].push(r);
  }
  return groups;
}

/** The deck a deck is inside, or null for a top-level one. */
const parentOf = (deck: string) => { const i = deck.lastIndexOf('::'); return i < 0 ? null : deck.slice(0, i); };

/**
 * For each level of well a row is inside (1 to its depth), whether it opens or closes that well:
 * the first row after the parent, the last before the next row that isn't inside it.
 */
function wellEnds(group: ShownRow[], i: number): { first: boolean; last: boolean }[] {
  return Array.from({ length: group[i].depth }, (_, k) => ({
    first: i === 0 || group[i - 1].depth < k + 1,
    last: i === group.length - 1 || group[i + 1].depth < k + 1,
  }));
}

/**
 * The tinted panels a subdeck sits in, inside its parent's card. A drag and the swipe measure each
 * row on its own, so rows can't share one panel: each row draws its own slice of every panel it's
 * in, rounding the corners where one opens or closes.
 */
function Wells({ ends, children }: { ends: { first: boolean; last: boolean }[]; children: React.ReactNode }) {
  const c = useTheme();
  let node = children;
  // From the innermost out. Odd levels are tinted and even ones are the card's own color, so a well in a well reads.
  for (let level = ends.length; level >= 1; level--) {
    const { first, last } = ends[level - 1];
    node = (
      <View
        style={{
          marginLeft: WELL_INSET, marginRight: WELL_EDGE, marginBottom: last ? WELL_EDGE : 0, overflow: 'hidden', ...smooth,
          backgroundColor: level % 2 === 1 ? c.fill : c.surface,
          borderTopLeftRadius: first ? radius.m : 0, borderTopRightRadius: first ? radius.m : 0,
          borderBottomLeftRadius: last ? radius.m : 0, borderBottomRightRadius: last ? radius.m : 0,
        }}
      >
        {node}
      </View>
    );
  }
  return <>{node}</>;
}

/** The round button that shows or hides subdecks: its chevron turns a quarter when they're hidden. */
function Disclosure({ open, fill, color }: { open: boolean; fill: string; color: string }) {
  const reduce = useReduceMotion();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: reduce ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: DISCLOSURE, height: DISCLOSURE, borderRadius: DISCLOSURE / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) }] }}>
        <Icon name="chevron.down" size={12} color={color} weight="semibold" />
      </Animated.View>
    </View>
  );
}

/** What's waiting across every deck, or that nothing is: the first thing the deck list says. */
function TodaySummary({ due, fresh }: { due: number; fresh: number }) {
  const c = useTheme();
  const caughtUp = due + fresh === 0;
  const figure = (value: number, label: string, color: string) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.largeTitle, color: value ? color : c.textTertiary, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={caughtUp ? 'All caught up. Nothing is due today.' : `Today: ${due} due, ${fresh} new`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l, borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border,
      }}
    >
      {caughtUp ? (
        <>
          <Icon name="checkmark.circle.fill" size={34} color={c.countDue} weight="regular" />
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
  );
}

/** A count over its label, in a fixed-width column so a deck's numbers line up with the next deck's. */
function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  const c = useTheme();
  return (
    <View style={{ minWidth: 40, alignItems: 'center' }}>
      <Text style={{ ...type.headline, color: value ? color : c.textTertiary, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

export function DeckRowView({ row, first, gutter = false, subdecks = 0, detail, menuHint = 'Add a note, rename, options or delete', onOpen, onMenu, onToggle, onLift, onStep }: {
  row: ShownRow;
  first: boolean;
  /** Room for the show/hide button before the name, so a deck's name lines up with its siblings'. */
  gutter?: boolean;
  /** How many subdecks it has directly, said under the name while they're hidden. */
  subdecks?: number;
  /** The line under the name in place of the card count (WaniKani's level), and its color. */
  detail?: { text: string; warning?: boolean };
  /** What the ⋯ menu offers, for VoiceOver. */
  menuHint?: string;
  onOpen: () => void;
  onMenu: () => void;
  onToggle?: () => void;
  /** Hold to drag the deck (DeckDrag.tsx). */
  onLift?: (e: GestureResponderEvent) => void;
  /** Move up or down among its siblings: VoiceOver's way to do what dragging does. */
  onStep?: (by: -1 | 1) => void;
}) {
  const c = useTheme();
  const atCap = row.gate && row.gate.inProgress >= row.gate.cap;
  // What the row sits on is the card's own color at even depths and a well's tint at odd ones; the
  // pressed state and the show/hide button take the other one, so they show.
  const onWell = row.depth % 2 === 1 ? c.surface : c.fill;
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLift}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}: ${row.due} due, ${row.fresh} new`}
      accessibilityActions={onStep ? [{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }] : undefined}
      onAccessibilityAction={(e) => onStep?.(e.nativeEvent.actionName === 'moveUp' ? -1 : 1)}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.s,
        minHeight: MIN_TAP + space.xl, paddingVertical: space.m, paddingRight: space.xs, paddingLeft: ROW_PAD,
        backgroundColor: pressed ? onWell : 'transparent',
      })}
    >
      {first ? null : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: space.l, right: 0, height: hairline, backgroundColor: c.border }} />}
      {gutter ? <View style={{ width: DISCLOSURE }} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ ...(row.depth === 0 ? type.headline : type.callout), color: c.text }}>{row.name}</Text>
        <Text style={{ ...type.footnote, color: detail?.warning ? c.warning : c.textSecondary }}>
          {detail ? detail.text : `${row.total.toLocaleString()} ${row.total === 1 ? 'card' : 'cards'}${row.collapsed && subdecks ? ` · ${subdecks} ${subdecks === 1 ? 'subdeck' : 'subdecks'}` : ''}`}
        </Text>
        {row.gate ? (
          // Under the cap, new cards come in; at it, they wait until cards are a week out.
          <Text style={{ ...type.footnote, color: atCap ? c.warning : c.textSecondary }}>
            {row.gate.inProgress} of {row.gate.cap} in progress{atCap ? ', new cards wait' : ''}
          </Text>
        ) : null}
      </View>
      <Stat value={row.due} label="due" color={c.countDue} />
      <Stat value={row.fresh} label="new" color={c.countNew} />
      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={`More for ${row.name}`}
        accessibilityHint={menuHint}
        style={({ pressed }) => ({ width: MIN_TAP - 4, height: MIN_TAP, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.4 : 1 })}
      >
        <Icon name="ellipsis" size={18} color={c.textTertiary} weight="semibold" />
      </Pressable>
      {row.hasSubdecks && onToggle ? (
        // Over the gutter before the name. Last in the row: a later sibling is hit-tested first, so
        // earlier it would hide the hit slop under the name.
        <Tappable
          onPress={() => { haptic.select(); onToggle(); }}
          accessibilityRole="button"
          accessibilityLabel={`${row.collapsed ? 'Show' : 'Hide'} the subdecks of ${row.name}`}
          accessibilityState={{ expanded: !row.collapsed }}
          hitSlop={{ left: space.xs, right: space.s }}
          scaleTo={0.9}
          dimTo={0.6}
          style={{ position: 'absolute', left: ROW_PAD, top: 0, bottom: 0, width: DISCLOSURE, alignItems: 'center', justifyContent: 'center' }}
        >
          <Disclosure open={!row.collapsed} fill={onWell} color={c.textSecondary} />
        </Tappable>
      ) : null}
    </Pressable>
  );
}

/** How long a tap on the sync button shows "Syncing" at least, however quickly the sync itself ends. */
const MIN_SYNC_SHOWN_MS = 1200;

export function DeckList(props: {
  decks: DeckRow[];
  /**
   * When the last backup was made, and whether another is due (`backupStatus`). Not shown while
   * sync is on: the Anki server then holds the collection, and Backup is still in Settings.
   */
  backup?: { text: string; overdue: boolean };
  /** False until the first load of the decks has finished, so an empty list isn't "No decks yet" yet. */
  loaded?: boolean;
  /** Answers given here and not yet in Anki: not synced, or (without sync) not sent back by file. */
  ankiUnsent?: number;
  /** Present when sync is on. */
  sync?: { syncing: boolean; status: string; failed: boolean; onSync: () => Promise<unknown> | void };
  onOpen: (deck: string) => void;
  onImport: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onBrowse: () => void;
  onOptions: (deck: string) => void;
  /** Makes a deck (DeckActions.tsx). */
  onNewDeck: () => void;
  /** The menu on a deck's row: add a note, rename, options, delete (DeckActions.tsx). */
  onDeckMenu: (deck: string) => void;
  /** A deck dragged to a new place: reordered, nested or unnested (`deckMove`, DeckActions.tsx). */
  onMoveDeck: (move: DeckMove) => void;
  /** Decks whose subdecks are hidden: Anki's own collapsed state, shared through sync. */
  collapsed?: Set<string>;
  onToggleCollapsed?: (deck: string) => void;
  /**
   * A deck that isn't Anki's (WaniKani, WaniKaniDeck.tsx), shown after the Anki decks and counted
   * in today's totals. `refresh` reads its counts again: on a pull, and with the sync button.
   */
  extra?: { node: React.ReactNode; due: number; fresh: number; refresh: () => Promise<unknown> };
}) {
  const c = useTheme();
  const shown = useMemo(() => shownDeckRows(props.decks, props.collapsed ?? new Set()), [props.decks, props.collapsed]);
  const groups = useMemo(() => groupByTopLevel(shown), [shown]);
  const allDecks = useMemo(() => props.decks.map((r) => r.deck), [props.decks]);
  // How many subdecks each deck has directly, and which decks have a child that can be hidden: all
  // of that deck's children keep a column before their names, so the names line up.
  const subdeckCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of props.decks) { const p = parentOf(r.deck); if (p !== null) m.set(p, (m.get(p) ?? 0) + 1); }
    return m;
  }, [props.decks]);
  const gutterParents = useMemo(() => {
    const set = new Set<string>();
    for (const r of shown) if (r.hasSubdecks) { const p = parentOf(r.deck); if (p !== null) set.add(p); }
    return set;
  }, [shown]);
  // The deck whose row is slid open on its Options action; one at a time.
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  // The pull-down spinner is for a pull-down only. Tied to every sync, the one at launch scrolled
  // the list to show the spinner, and the large title flashed open and snapped shut.
  const [pulling, setPulling] = useState(false);
  // A tap on the sync button shows "Syncing" for at least MIN_SYNC_SHOWN_MS, so a sync that has
  // nothing to do or finishes at once still visibly did something.
  const [tapped, setTapped] = useState(false);
  const syncShown = !!props.sync && (props.sync.syncing || tapped);
  const syncTapped = async () => {
    if (!props.sync || syncShown) return;
    setTapped(true);
    props.extra?.refresh();
    try {
      await Promise.all([props.sync.onSync(), new Promise((resolve) => setTimeout(resolve, MIN_SYNC_SHOWN_MS))]);
    } finally {
      setTapped(false);
    }
  };
  const totals = useMemo(() => {
    const t = deckListTotals(props.decks);
    return props.extra ? { due: t.due + props.extra.due, fresh: t.fresh + props.extra.fresh } : t;
  }, [props.decks, props.extra?.due, props.extra?.fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const backup = props.sync ? undefined : props.backup;
  const drag = useDeckDrag({
    decks: allDecks,
    shown,
    onMove: props.onMoveDeck,
    renderCard: (deck) => {
      const row = shown.find((r) => r.deck === deck);
      return row ? <DeckRowView row={row} first onOpen={() => undefined} onMenu={() => undefined} onToggle={() => undefined} /> : null;
    },
  });
  const step = (deck: string, by: -1 | 1) => {
    const move = siblingStep(allDecks, deck, by);
    if (move) props.onMoveDeck(move);
  };
  return (
    <Screen
      title="Decks"
      toolbar={
        <Stack.Toolbar placement="right">
          {props.sync ? (
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" disabled={syncShown} accessibilityLabel={syncShown ? 'Syncing' : 'Sync now'} onPress={syncTapped} />
          ) : null}
          <Stack.Toolbar.Button icon="rectangle.stack.badge.plus" accessibilityLabel="New deck" onPress={props.onNewDeck} />
          <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Browse and search notes" onPress={props.onBrowse} />
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={props.onSettings} />
        </Stack.Toolbar>
      }
    >
      <ScrollView
        {...drag.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        // Pull down to sync, when sync is on, and to read WaniKani's counts again. Always mounted:
        // sync's settings load a moment after the screen opens, and a refresh control added then
        // moved the content down and showed the large title that had been scrolled out of view at
        // launch. With neither, a pull does nothing.
        refreshControl={(
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              try { await Promise.all([props.sync?.onSync(), props.extra?.refresh()]); } finally { setPulling(false); }
            }}
            tintColor={c.textSecondary}
          />
        )}
      >
        {/* Everything in one view, which a drag measures the rows against and draws its card in. */}
        <View {...drag.contentProps} style={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
          {backup?.overdue ? (
            <Pressable onPress={props.onBackup} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
              <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'center', borderRadius: radius.l, ...smooth, borderWidth: 1, borderColor: c.warning, backgroundColor: c.surface, padding: space.m }}>
                <Icon name="exclamationmark.triangle.fill" size={22} color={c.warning} />
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={{ ...type.headline, color: c.warning }}>{backup.text}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>Everything is stored only on this iPhone. Tap to back up now.</Text>
                </View>
              </View>
            </Pressable>
          ) : null}
          {groups.length || props.extra ? <TodaySummary due={totals.due} fresh={totals.fresh} /> : null}
          {groups.length === 0 ? (props.loaded === false ? null : (
            <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
              <Icon name="tray" size={40} color={c.textTertiary} weight="regular" />
              <Text style={{ ...type.title, color: c.text, marginTop: space.s }}>No decks yet</Text>
              <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21, textAlign: 'center', marginBottom: space.m }}>
                Bring in your Anki collection, by syncing with your Anki server or from a file exported from AnkiMobile.
              </Text>
              <Button label="Set up Anki" onPress={props.onImport} style={{ alignSelf: 'stretch' }} />
            </Card>
          )) : (
            groups.map((g) => (
              <Group key={g[0].deck}>
                {g.map((row, i) => (
                  // Measured by a drag, and dimmed while it, or a deck it's inside, is being dragged.
                  <View key={row.deck} ref={drag.rowRef(row.deck)} collapsable={false} style={{ opacity: drag.dragging !== null && isInDeck(row.deck, drag.dragging) ? 0.35 : 1 }}>
                    <Wells ends={wellEnds(g, i)}>
                    <SwipeToReveal
                      open={openDeck === row.deck}
                      onOpenChange={(open) => setOpenDeck(open ? row.deck : null)}
                      action={
                        <Pressable
                          onPress={() => { setOpenDeck(null); props.onOptions(row.deck); }}
                          accessibilityRole="button"
                          accessibilityLabel={`Options for ${row.name}`}
                          style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 })}
                        >
                          <Icon name="gearshape" size={22} color={c.onAccent} />
                          <Text style={{ ...type.footnote, color: c.onAccent, fontWeight: '600' }}>Options</Text>
                        </Pressable>
                      }
                    >
                      <DeckRowView
                        row={row}
                        first={i === 0 || wellEnds(g, i)[row.depth - 1]?.first === true}
                        gutter={!!props.onToggleCollapsed && (row.hasSubdecks || (parentOf(row.deck) !== null && gutterParents.has(parentOf(row.deck)!)))}
                        subdecks={subdeckCounts.get(row.deck) ?? 0}
                        // Tapping a row that's slid open closes it, rather than opening the deck.
                        onOpen={() => (openDeck === row.deck ? setOpenDeck(null) : props.onOpen(row.deck))}
                        onMenu={() => props.onDeckMenu(row.deck)}
                        onToggle={props.onToggleCollapsed ? () => props.onToggleCollapsed!(row.deck) : undefined}
                        onLift={(e) => { setOpenDeck(null); drag.begin(row.deck, e); }}
                        onStep={(by) => step(row.deck, by)}
                      />
                    </SwipeToReveal>
                    </Wells>
                  </View>
                ))}
              </Group>
            ))
          )}
          {props.extra?.node}
          {props.sync ? (
            <Pressable onPress={syncTapped} accessibilityRole="button" accessibilityHint="Syncs now"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: props.sync.failed ? c.warning : c.textSecondary, textAlign: 'center' }}>
                {syncShown ? 'Syncing…' : props.sync.status}
                {props.ankiUnsent ? ` ${props.ankiUnsent} ${props.ankiUnsent === 1 ? "answer isn't" : "answers aren't"} synced yet.` : ''}
              </Text>
            </Pressable>
          ) : props.ankiUnsent ? (
            <Pressable onPress={props.onImport} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>
                {props.ankiUnsent} {props.ankiUnsent === 1 ? "answer isn't" : "answers aren't"} in Anki yet. Tap to send.
              </Text>
            </Pressable>
          ) : null}
          {backup && !backup.overdue ? (
            <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{backup.text}</Text>
          ) : null}
          {drag.overlay}
        </View>
      </ScrollView>
    </Screen>
  );
}
