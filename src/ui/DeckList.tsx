import { Link, Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, LayoutAnimation, Pressable, RefreshControl, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { siblingStep, type DeckMove } from '../core/deckOrder';
import { deckListTotals, isInDeck, shownDeckRows, type DeckRow } from '../core/deckTree';
import { useDeckDrag } from './DeckDrag';
import { DISCLOSURE, ROW_PAD } from './deckLayout';
import { haptic } from './haptics';
import { Button, Card, Group, Icon, Screen, SwipeAction, SwipeToReveal, Tappable } from './kit';
import { Reveal, useReduceMotion } from './motion';
import { useHeaderInset } from './useHeaderInset';
import { NoteQueueCard, useNoteQueueBanner } from './NoteQueueBanner';
import { VacationCard, useVacationBanner } from './vacationNotice';
import { useVocabReady, VocabReadyCard } from './VocabReadyBanner';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';

type ShownRow = DeckRow & { hasSubdecks: boolean; collapsed: boolean };

/** What a deck's long-press menu and its ⋯ button offer besides studying it. */
export type DeckAction = 'note' | 'rename' | 'options' | 'export' | 'delete';

/** Rows grouped under their top-level deck, so each family of decks sits in one card. */
function groupByTopLevel(rows: ShownRow[]): ShownRow[][] {
  const groups: ShownRow[][] = [];
  for (const r of rows) {
    if (r.depth === 0 || !groups.length) groups.push([r]);
    else groups[groups.length - 1].push(r);
  }
  return groups;
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
function TodaySummary({ due, fresh, studied }: { due: number; fresh: number; studied?: string }) {
  const c = useTheme();
  const caughtUp = due + fresh === 0;
  const figure = (value: number, label: string, color: string) => (
    <View style={{ flex: 1, gap: 2, alignItems: 'center' }}>
      <Text style={{ ...type.largeTitle, color: value ? color : c.textDim, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={[caughtUp ? 'All caught up. Nothing is due today.' : `Today: ${due} due, ${fresh} new`, studied].filter(Boolean).join('. ')}
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
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center', fontVariant: ['tabular-nums'], borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.s }}>
          {studied}
        </Text>
      ) : null}
    </View>
  );
}

/** A count over its label, in a fixed-width column so a deck's numbers line up with the next deck's. */
function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  const c = useTheme();
  return (
    <View style={{ minWidth: 40, alignItems: 'center' }}>
      <Text style={{ ...type.headline, color: value ? color : c.textDim, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

export function DeckRowView({ row, first, toggleSlot = false, detail, menuHint = 'Add a note, rename, options or delete', editing = false, onOpen, onPress, onMenu, onToggle, onDelete, onHandle, onStep }: {
  row: ShownRow;
  first: boolean;
  /** Room at the right edge for the show/hide button, so every row's counts line up whether or not it has subdecks. */
  toggleSlot?: boolean;
  /** The line under the name in place of the card count (WaniKani's level), and its color. */
  detail?: { text: string; warning?: boolean };
  /** What the ⋯ menu offers, for VoiceOver. */
  menuHint?: string;
  /** Edit mode: a delete button before the name and a handle to drag the deck by, in place of the counts and the menu. */
  editing?: boolean;
  onOpen?: () => void;
  /** The press a `Link` hands its trigger (the row is that trigger's element), used in place of `onOpen`. */
  onPress?: () => void;
  onMenu: () => void;
  onToggle?: () => void;
  /** Edit mode's delete button. */
  onDelete?: () => void;
  /** Touching the handle in Edit mode picks the deck up to drag it (DeckDrag.tsx). */
  onHandle?: (e: GestureResponderEvent) => void;
  /** Move up or down among its siblings: VoiceOver's way to do what dragging does. */
  onStep?: (by: -1 | 1) => void;
}) {
  const c = useTheme();
  const atCap = row.gate && row.gate.inProgress >= row.gate.cap;
  // A top-level deck that has subdecks is tinted, as a header for the rows under it; the pressed
  // state and the show/hide button take the other color, so they show.
  const tinted = row.depth === 0 && row.hasSubdecks;
  const base = tinted ? c.fill : c.surface;
  const onWell = tinted ? c.surface : c.fill;
  // Rows aren't indented, so a deck inside a subdeck says which one. Editing says it for every
  // subdeck: dragging one sideways moves it between decks, and the list alone doesn't show where.
  const parts = row.deck.split('::');
  const inDeck = row.depth >= (editing ? 1 : 2) ? `in ${parts[parts.length - 2]}` : '';
  // A detail line (WaniKani's level) goes under the name too; the card counts were dropped to save space.
  const line = detail ? detail.text : inDeck;
  const gateLine = row.gate ? `${row.gate.inProgress} of ${row.gate.cap} in progress${atCap ? ', new cards wait' : ''}` : null;
  return (
    <Pressable
      onPress={editing ? undefined : (onPress ?? onOpen)}
      disabled={editing}
      accessibilityRole={editing ? undefined : 'button'}
      accessible={!editing}
      // The label replaces the text inside, so it says the lines under the name too.
      accessibilityLabel={[`${row.name}: ${row.due} due, ${row.fresh} new`, line.replace(' · ', ', '), gateLine].filter(Boolean).join('. ')}
      accessibilityActions={onStep ? [{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }] : undefined}
      onAccessibilityAction={(e) => onStep?.(e.nativeEvent.actionName === 'moveUp' ? -1 : 1)}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.s,
        minHeight: MIN_TAP + space.xl, paddingVertical: space.m, paddingRight: space.xs, paddingLeft: ROW_PAD,
        backgroundColor: pressed ? onWell : base,
      })}
    >
      {first ? null : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: space.l, right: 0, height: hairline, backgroundColor: c.border }} />}
      {editing ? (
        <Tappable
          onPress={() => { haptic.tap(); onDelete?.(); }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${row.name}`}
          scaleTo={0.85}
          hitSlop={space.s}
          style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="minus" size={12} color={c.onRating} weight="bold" />
        </Tappable>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ ...(row.depth === 0 ? type.headline : type.callout), color: c.text }}>{row.name}</Text>
        {line ? <Text style={{ ...type.footnote, color: detail?.warning ? c.warning : c.textSecondary }}>{line}</Text> : null}
        {gateLine ? (
          // Under the cap, new cards come in; at it, they wait until cards are a week out.
          <Text style={{ ...type.footnote, color: atCap ? c.warning : c.textSecondary }}>{gateLine}</Text>
        ) : null}
      </View>
      {editing ? (
        // Touching the handle picks the deck up at once; the list's own scrolling gives way to the drag.
        <Pressable
          onPressIn={onHandle}
          accessibilityRole="adjustable"
          accessibilityLabel={`Move ${row.name}`}
          accessibilityHint="Swipe up or down to move it among its siblings"
          accessibilityActions={onStep ? [{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }] : undefined}
          onAccessibilityAction={(e) => onStep?.(e.nativeEvent.actionName === 'decrement' ? -1 : 1)}
          hitSlop={space.s}
          style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="line.3.horizontal" size={18} color={c.textTertiary} weight="semibold" />
        </Pressable>
      ) : (<>
      <Stat value={row.due} label="due" color={c.countDue} />
      <Stat value={row.fresh} label="new" color={c.countNew} />
      <Tappable
        onPress={() => { haptic.tap(); onMenu(); }}
        accessibilityRole="button"
        accessibilityLabel={`More for ${row.name}`}
        accessibilityHint={menuHint}
        scaleTo={0.85}
        dimTo={0.4}
        // Drawn 4pt narrower than a full tap target to leave the counts room; the slop makes up the rest.
        hitSlop={{ left: 2, right: 2 }}
        style={{ width: MIN_TAP - 4, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="ellipsis" size={18} color={c.textTertiary} weight="semibold" />
      </Tappable>
      {toggleSlot ? (
        <View style={{ width: DISCLOSURE, alignItems: 'center', justifyContent: 'center' }}>
          {row.hasSubdecks && onToggle ? (
            <Tappable
              onPress={() => { haptic.select(); onToggle(); }}
              accessibilityRole="button"
              accessibilityLabel={`${row.collapsed ? 'Show' : 'Hide'} the subdecks of ${row.name}`}
              accessibilityState={{ expanded: !row.collapsed }}
              hitSlop={{ left: space.xs, right: space.xs, top: space.s, bottom: space.s }}
              scaleTo={0.9}
              dimTo={0.6}
            >
              <Disclosure open={!row.collapsed} fill={onWell} color={c.textSecondary} />
            </Tappable>
          ) : null}
        </View>
      ) : null}
      </>)}
    </Pressable>
  );
}

/**
 * Something on the deck list that needs doing (a backup overdue, a sync or a load that failed):
 * a card edged in the warning color, with what to tap for in the accent color. The whole card is the button.
 */
function WarningBanner({ title, detail, action, hint, onPress }: { title: string; detail: string; action: string; hint?: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Reveal>
    <Tappable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityHint={hint} scaleTo={0.98}>
      <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start', borderRadius: radius.l, ...smooth, borderWidth: 1, borderColor: c.warning, backgroundColor: c.surface, padding: space.m }}>
        <Icon name="exclamationmark.triangle.fill" size={22} color={c.warning} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.warning }}>{title}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{detail}</Text>
          <Text style={{ ...type.subhead, color: c.accent, fontWeight: '600' }}>{action}</Text>
        </View>
      </View>
    </Tappable>
    </Reveal>
  );
}

/** How long a tap on the sync button shows "Syncing" at least, however quickly the sync itself ends. */
const MIN_SYNC_SHOWN_MS = 1200;

export function DeckList(props: {
  decks: DeckRow[];
  /** "Studied today: ..." under the due and new figures (useTodaySummary), once something has been answered today. */
  studied?: string;
  /**
   * When the last backup was made, and whether another is due (`backupStatus`). Not shown while
   * sync is on: the Anki server then holds the collection, and Backup is still in Settings.
   */
  backup?: { text: string; overdue: boolean };
  /** Why the decks couldn't be loaded, when the last try failed: the rows shown may be out of date. */
  loadProblem?: { text: string; onRetry: () => void };
  /** False until the first load of the decks has finished, so an empty list isn't "No decks yet" yet. */
  loaded?: boolean;
  /** Answers given here and not yet in Anki: not synced, or (without sync) not sent back by file. */
  ankiUnsent?: number;
  /** Present when sync is on. */
  sync?: { syncing: boolean; status: string; failed: boolean; onSync: () => Promise<unknown> | void };
  onImport: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onOptions: (deck: string) => void;
  /** Makes a deck (DeckActions.tsx). */
  onNewDeck: () => void;
  /** Quick add (ReadQuickAdd.tsx); present while Read & Listen is on, since Claude fills the notes in there. */
  onQuickAdd?: () => void;
  /** The ⋯ button on a deck's row: add a note, rename, options, export, delete (DeckActions.tsx). */
  onDeckMenu: (deck: string) => void;
  /** One of those, chosen from the menu a long press on the row opens. */
  onDeckAction: (deck: string, action: DeckAction) => void;
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
  /** Today's extras (DailyExtras.tsx), under the day's count. */
  extrasStrip?: React.ReactNode;
}) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const header = useHeaderInset();
  const { banner: vocabReady } = useVocabReady();
  const noteQueue = useNoteQueueBanner();
  const vacation = useVacationBanner();
  const shown = useMemo(() => shownDeckRows(props.decks, props.collapsed ?? new Set()), [props.decks, props.collapsed]);
  const groups = useMemo(() => groupByTopLevel(shown), [shown]);
  const allDecks = useMemo(() => props.decks.map((r) => r.deck), [props.decks]);
  // The deck whose row is slid open on its Options action; one at a time.
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  // Edit mode: rows show a delete button and a handle to drag them by, and don't open.
  const [editing, setEditing] = useState(false);
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
      return row ? <DeckRowView row={row} first editing onMenu={() => undefined} /> : null;
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
          {editing ? (
            <Stack.Toolbar.Button accessibilityLabel="Done editing decks" onPress={() => { haptic.tap(); setEditing(false); }}>Done</Stack.Toolbar.Button>
          ) : null}
          {!editing && props.sync ? (
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" disabled={syncShown} accessibilityLabel={syncShown ? 'Syncing' : 'Sync now'} onPress={syncTapped} />
          ) : null}
          {!editing ? <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Browse and search notes" onPress={props.onBrowse} /> : null}
          {!editing ? <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={props.onSettings} /> : null}
          {/* What's used less often than opening a deck, so the bar stays at four buttons. */}
          {!editing ? <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More: new deck, edit decks, quick add notes or stats">
            <Stack.Toolbar.MenuAction icon="rectangle.stack.badge.plus" onPress={props.onNewDeck}>New deck</Stack.Toolbar.MenuAction>
            {groups.length ? <Stack.Toolbar.MenuAction icon="arrow.up.arrow.down" onPress={() => { setOpenDeck(null); setEditing(true); }}>Edit decks</Stack.Toolbar.MenuAction> : null}
            {props.onQuickAdd ? <Stack.Toolbar.MenuAction icon="plus" onPress={props.onQuickAdd}>Quick add notes</Stack.Toolbar.MenuAction> : null}
            <Stack.Toolbar.MenuAction icon="chart.bar" onPress={props.onStats}>Stats</Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu> : null}
        </Stack.Toolbar>
      }
    >
      <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1 }}>
      <ScrollView
        {...drag.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={readable}
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
          {/* Today's count first; what needs doing sits under it, so a few banners never push it off the screen. */}
          {groups.length || props.extra ? <TodaySummary due={totals.due} fresh={totals.fresh} studied={props.studied} /> : null}
          {props.extrasStrip}
          {backup?.overdue ? (
            <WarningBanner title={backup.text} detail="Everything is stored only on this iPhone." action="Tap to back up now" hint="Opens Backup" onPress={props.onBackup} />
          ) : null}
          {props.loadProblem ? (
            <WarningBanner title="Couldn't load your decks" detail={props.loadProblem.text} action="Tap to try again" hint="Loads the decks again" onPress={props.loadProblem.onRetry} />
          ) : null}
          {vocabReady ? <VocabReadyCard banner={vocabReady} /> : null}
          {noteQueue ? <NoteQueueCard banner={noteQueue} /> : null}
          {vacation ? <VacationCard notice={vacation} due={totals.due} /> : null}
          {props.sync?.failed ? (
            // A failed sync sits right under today's count, where it can't be scrolled past; a tap tries again.
            <WarningBanner title="Sync didn't finish" detail={props.sync.status} action="Tap to try again" hint="Syncs now" onPress={syncTapped} />
          ) : null}
          {groups.length === 0 ? (props.loaded === false ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : (
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
                    {editing ? (
                      <DeckRowView
                        row={row}
                        first={i === 0}
                        toggleSlot={!!props.onToggleCollapsed}
                        editing
                        onMenu={() => props.onDeckMenu(row.deck)}
                        onDelete={() => props.onDeckAction(row.deck, 'delete')}
                        onHandle={(e) => drag.begin(row.deck, e)}
                        onStep={(by) => step(row.deck, by)}
                      />
                    ) : (
                    <SwipeToReveal
                      open={openDeck === row.deck}
                      onOpenChange={(open) => setOpenDeck(open ? row.deck : null)}
                      // A swipe across the whole row opens Options, as a full swipe does in Mail.
                      onFullSwipe={() => props.onOptions(row.deck)}
                      action={<SwipeAction icon="gearshape" label="Options" accessibilityLabel={`Options for ${row.name}`} onPress={() => { setOpenDeck(null); props.onOptions(row.deck); }} />}
                    >
                      {/* A long press opens iOS's own menu for the deck; a tap studies it (the link). The row takes the link's press itself. */}
                      <Link
                        href={{ pathname: '/review', params: { deck: row.deck } }}
                        asChild
                        // Tapping a row that's slid open closes it, rather than opening the deck.
                        onPress={(e) => { if (openDeck === row.deck) { e.preventDefault(); setOpenDeck(null); } }}
                      >
                        <Link.Trigger>
                          <DeckRowView
                            row={row}
                            first={i === 0}
                            toggleSlot={!!props.onToggleCollapsed}
                            onMenu={() => props.onDeckMenu(row.deck)}
                            onToggle={props.onToggleCollapsed ? () => {
                              // The rows below slide into place instead of jumping.
                              if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
                              props.onToggleCollapsed!(row.deck);
                            } : undefined}
                            onStep={(by) => step(row.deck, by)}
                          />
                        </Link.Trigger>
                        <Link.Menu title={row.name}>
                          <Link.MenuAction icon="plus" onPress={() => props.onDeckAction(row.deck, 'note')}>Add note</Link.MenuAction>
                          <Link.MenuAction icon="pencil" onPress={() => props.onDeckAction(row.deck, 'rename')}>Rename</Link.MenuAction>
                          <Link.MenuAction icon="gearshape" onPress={() => props.onDeckAction(row.deck, 'options')}>Deck options</Link.MenuAction>
                          <Link.MenuAction icon="square.and.arrow.up" onPress={() => props.onDeckAction(row.deck, 'export')}>Export notes</Link.MenuAction>
                          <Link.MenuAction icon="trash" destructive onPress={() => props.onDeckAction(row.deck, 'delete')}>Delete</Link.MenuAction>
                        </Link.Menu>
                      </Link>
                    </SwipeToReveal>
                    )}
                  </View>
                ))}
              </Group>
            ))
          )}
          {props.extra?.node}
          {props.sync && (!props.sync.failed || props.ankiUnsent) ? (
            <Pressable onPress={syncTapped} accessibilityRole="button" accessibilityHint="Syncs now"
              // A line of footnote text is about 18pt tall; the slop makes it a full tap target without moving the list.
              hitSlop={{ top: space.l, bottom: space.l }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: props.sync.failed ? c.warning : c.textSecondary, textAlign: 'center' }}>
                {props.sync.failed ? '' : props.sync.status}
                {props.ankiUnsent ? ` ${props.ankiUnsent} ${props.ankiUnsent === 1 ? "answer isn't" : "answers aren't"} synced yet.` : ''}
              </Text>
            </Pressable>
          ) : props.ankiUnsent ? (
            <Pressable onPress={props.onImport} accessibilityRole="button" hitSlop={{ top: space.l, bottom: space.l }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
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
      {syncShown ? (
        // Over the list, not in it, so the rows don't move when it comes and goes; taps pass through.
        <View pointerEvents="none" style={{ position: 'absolute', top: header.top + space.s, left: 0, right: 0, alignItems: 'center' }}>
          <Reveal rise={-8}>
          <View accessibilityRole="progressbar" accessibilityLabel="Syncing" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.pill, paddingVertical: space.s, paddingHorizontal: space.m, ...lift(c, 'high') }}>
            <ActivityIndicator size="small" color={c.textSecondary} />
            <Text style={{ ...type.footnote, color: c.text }}>Syncing…</Text>
          </View>
          </Reveal>
        </View>
      ) : null}
      </View>
    </Screen>
  );
}
