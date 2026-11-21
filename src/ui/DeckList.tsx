import { Link, Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, LayoutAnimation, Pressable, RefreshControl, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { leadingEmoji } from '../core/deckBadge';
import { useDeckTint } from './useDeckTint';
import { siblingStep, type DeckMove } from '../core/deckOrder';
import { isInDeck, shownDeckRows, type DeckRow } from '../core/deckTree';
import { useDeckDrag } from './DeckDrag';
import { DISCLOSURE, ROW_PAD } from './deckLayout';
import { haptic } from './haptics';
import { Button, Card, Group, Icon, Screen, SwipeAction, SwipeToReveal, Tappable } from './kit';
import { CountingText, Reveal, useReduceMotion } from './motion';
import { useHeaderInset } from './useHeaderInset';
import { SyncingPill, useSyncTap, type SyncProp } from './syncTap';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';

export type ShownRow = DeckRow & { hasSubdecks: boolean; collapsed: boolean };

/** What a deck's long-press menu and its ⋯ button offer besides studying it. */
export type DeckAction = 'quick' | 'note' | 'rename' | 'options' | 'export' | 'suspend' | 'unsuspend' | 'delete';

/** Rows grouped under their top-level deck, so each family of decks sits in one card. */
export function groupByTopLevel(rows: ShownRow[]): ShownRow[][] {
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

/**
 * A count over its label, in a fixed-width column so a deck's numbers line up with the next deck's.
 * A count with something in it sits on a pill of its own color; it ticks to a new value when the
 * deck list is recounted (back from studying, after a sync).
 */
function Stat({ value, label, color, fill }: { value: number; label: string; color: string; fill: string }) {
  const c = useTheme();
  return (
    <View style={{ minWidth: 44, alignItems: 'center', gap: 2 }}>
      <View style={{ minWidth: 40, alignItems: 'center', borderRadius: radius.pill, ...smooth, paddingHorizontal: space.xs + 2, paddingVertical: 2, backgroundColor: value ? fill : 'transparent' }}>
        <CountingText value={value} style={{ ...type.headline, color: value ? color : c.textDim, fontVariant: ['tabular-nums'] }} />
      </View>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

/** The emoji a deck's name starts with, on a soft tile in the deck's own tint (`deckTint`). */
function DeckBadge({ deck, emoji }: { deck: string; emoji: string }) {
  const tintOf = useDeckTint();
  return (
    <View style={{ width: BADGE, height: BADGE, borderRadius: radius.m, ...smooth, backgroundColor: tintOf(deck), alignItems: 'center', justifyContent: 'center' }}>
      {/* Not scaled with the text size: it's the deck's mark, and a fixed tile has to hold it. */}
      <Text allowFontScaling={false} style={{ fontSize: 20 }}>{emoji}</Text>
    </View>
  );
}
const BADGE = 36;

/** A deck as the small pill that follows the finger while it's dragged (DeckDrag.tsx): its mark and its name. */
function DeckChip({ row }: { row: ShownRow }) {
  const c = useTheme();
  const badge = leadingEmoji(row.name);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingLeft: space.s, paddingRight: space.l }}>
      {badge.emoji ? <DeckBadge deck={row.deck} emoji={badge.emoji} /> : <View style={{ width: space.s }} />}
      <Text numberOfLines={1} style={{ ...type.callout, fontWeight: '600', color: c.text, flexShrink: 1 }}>{badge.rest}</Text>
    </View>
  );
}

/** How long a family of decks waits to settle in, by its place in the list (Decks and Today): 45 ms apart, none after the seventh. */
export const settleDelay = (group: number) => Math.min(group, 6) * 45;

export function DeckRowView({ row, first, toggleSlot = false, detail, menuHint = 'Quick add, add a note, rename, options or delete', below, belowLabel, editing = false, onOpen, onPress, onMenu, onToggle, onDelete, onHandle, onStep }: {
  row: ShownRow;
  first: boolean;
  /** Room at the right edge for the show/hide button, so every row's counts line up whether or not it has subdecks. */
  toggleSlot?: boolean;
  /** The line under the name in place of the card count (WaniKani's level), and its color. */
  detail?: { text: string; warning?: boolean };
  /** What the ⋯ menu offers, for VoiceOver. */
  menuHint?: string;
  /** Under the lines of text (WaniKani's stage bar), and what it says aloud. */
  below?: React.ReactNode;
  belowLabel?: string;
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
  const badge = leadingEmoji(row.name);
  // The line stays short; at the cap it turns warning-colored, and VoiceOver also hears that new cards wait.
  const gateLine = row.gate ? `${row.gate.inProgress} of ${row.gate.cap} in progress` : null;
  return (
    <Pressable
      onPress={editing ? undefined : (onPress ?? onOpen)}
      disabled={editing}
      accessibilityRole={editing ? undefined : 'button'}
      accessible={!editing}
      // The label replaces the text inside, so it says the lines under the name too.
      accessibilityLabel={[`${row.name}: ${row.due} due, ${row.fresh} new`, line.replace(' · ', ', '), belowLabel, gateLine && atCap ? `${gateLine}, new cards wait` : gateLine].filter(Boolean).join('. ')}
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
      {badge.emoji ? <DeckBadge deck={row.deck} emoji={badge.emoji} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ ...(row.depth === 0 ? type.headline : type.callout), color: c.text }}>{badge.rest}</Text>
        {line ? <Text style={{ ...type.footnote, color: detail?.warning ? c.warning : c.textSecondary }}>{line}</Text> : null}
        {below}
        {gateLine ? (
          // Under the cap, new cards come in; at it, they wait until cards are a week out (the color says so).
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
      <Stat value={row.due} label="due" color={c.countDue} fill={c.goodFill} />
      <Stat value={row.fresh} label="new" color={c.countNew} fill={c.countNewFill} />
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
 * Something that needs doing (a backup overdue, a sync or a load that failed), on Today or Decks:
 * a card edged in the warning color, with what to tap for in the accent color. The whole card is the button.
 */
export function WarningBanner({ title, detail, action, hint, onPress }: { title: string; detail: string; action: string; hint?: string; onPress: () => void }) {
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

/**
 * A deck's row outside Edit mode, on Decks and Today: a tap studies it, a long press opens iOS's
 * own menu for it, and a swipe reveals Options (a full swipe opens them, as in Mail).
 */
export function DeckRowLink({ row, first, toggleSlot, open, onOpenChange, onOptions, onMenu, onAction, onToggle, onStep }: {
  row: ShownRow;
  first: boolean;
  toggleSlot: boolean;
  /** Slid open on its Options action; one row at a time, so the list holds which. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptions: () => void;
  onMenu: () => void;
  onAction: (action: DeckAction) => void;
  onToggle?: () => void;
  onStep?: (by: -1 | 1) => void;
}) {
  const reduce = useReduceMotion();
  return (
    <SwipeToReveal
      open={open}
      onOpenChange={onOpenChange}
      onFullSwipe={onOptions}
      action={<SwipeAction icon="gearshape" label="Options" accessibilityLabel={`Options for ${row.name}`} onPress={() => { onOpenChange(false); onOptions(); }} />}
    >
      {/* The row takes the link's press itself. */}
      <Link
        href={{ pathname: '/review', params: { deck: row.deck } }}
        asChild
        // Tapping a row that's slid open closes it, rather than opening the deck.
        onPress={(e) => { if (open) { e.preventDefault(); onOpenChange(false); } }}
      >
        <Link.Trigger>
          <DeckRowView
            row={row}
            first={first}
            toggleSlot={toggleSlot}
            onMenu={onMenu}
            onToggle={onToggle ? () => {
              // The rows below slide into place instead of jumping.
              if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
              onToggle();
            } : undefined}
            onStep={onStep}
          />
        </Link.Trigger>
        <Link.Menu title={row.name}>
          <Link.MenuAction icon="text.badge.plus" onPress={() => onAction('quick')}>{`Quick add to ${row.name}`}</Link.MenuAction>
      <Link.MenuAction icon="plus" onPress={() => onAction('note')}>Add note</Link.MenuAction>
          <Link.MenuAction icon="pencil" onPress={() => onAction('rename')}>Rename</Link.MenuAction>
          <Link.MenuAction icon="gearshape" onPress={() => onAction('options')}>Deck options</Link.MenuAction>
          <Link.MenuAction icon="square.and.arrow.up" onPress={() => onAction('export')}>Export notes</Link.MenuAction>
          <Link.MenuAction icon="pause.circle" onPress={() => onAction('suspend')}>Suspend all</Link.MenuAction>
          <Link.MenuAction icon="play.circle" onPress={() => onAction('unsuspend')}>Unsuspend all</Link.MenuAction>
          <Link.MenuAction icon="trash" destructive onPress={() => onAction('delete')}>Delete</Link.MenuAction>
        </Link.Menu>
      </Link>
    </SwipeToReveal>
  );
}

/** With no decks at all: where to bring them in from. */
export function NoDecksCard({ onImport }: { onImport: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
      <Icon name="tray" size={40} color={c.textTertiary} weight="regular" />
      <Text style={{ ...type.title, color: c.text, marginTop: space.s }}>No decks yet</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21, textAlign: 'center', marginBottom: space.m }}>
        Bring in your Anki collection, by syncing with your Anki server or from a file exported from AnkiMobile.
      </Text>
      <Button label="Set up Anki" onPress={onImport} style={{ alignSelf: 'stretch' }} />
    </Card>
  );
}

export function DeckList(props: {
  decks: DeckRow[];
  /**
   * When the last backup was made, and whether another is due (`backupStatus`), as a line under
   * the decks; Today warns when it's overdue. Not shown while sync is on: the Anki server then
   * holds the collection, and Backup is still in Settings.
   */
  backup?: { text: string; overdue: boolean };
  /** Why the decks couldn't be loaded, when the last try failed: the rows shown may be out of date. */
  loadProblem?: { text: string; onRetry: () => void };
  /** False until the first load of the decks has finished, so an empty list isn't "No decks yet" yet. */
  loaded?: boolean;
  /** Answers given here and not yet in Anki: not synced, or (without sync) not sent back by file. */
  ankiUnsent?: number;
  /** Present when sync is on. */
  sync?: SyncProp;
  onImport: () => void;
  onSettings: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onOptions: (deck: string) => void;
  /** Makes a deck (DeckActions.tsx). */
  onNewDeck: () => void;
  /** Quick add (QuickAdd.tsx), from the header's + button. */
  onQuickAdd: () => void;
  /** The ⋯ button on a deck's row: add a note, rename, options, export, suspend or unsuspend all, delete (DeckActions.tsx). */
  onDeckMenu: (deck: string) => void;
  /** One of those, chosen from the menu a long press on the row opens. */
  onDeckAction: (deck: string, action: DeckAction) => void;
  /** A deck dragged to a new place: reordered, nested or unnested (`deckMove`, DeckActions.tsx). */
  onMoveDeck: (move: DeckMove) => void;
  /** Decks whose subdecks are hidden: Anki's own collapsed state, shared through sync. */
  collapsed?: Set<string>;
  onToggleCollapsed?: (deck: string) => void;
  /**
   * A deck that isn't Anki's (WaniKani, WaniKaniDeck.tsx), shown above the Anki decks and counted
   * in today's totals. `refresh` reads its counts again: on a pull, and with the sync button.
   */
  extra?: { node: React.ReactNode; due: number; fresh: number; refresh: () => Promise<unknown> };
}) {
  const c = useTheme();
  const header = useHeaderInset();
  const shown = useMemo(() => shownDeckRows(props.decks, props.collapsed ?? new Set()), [props.decks, props.collapsed]);
  const groups = useMemo(() => groupByTopLevel(shown), [shown]);
  const allDecks = useMemo(() => props.decks.map((r) => r.deck), [props.decks]);
  // The deck whose row is slid open on its Options action; one at a time.
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  // Edit mode: rows show a delete button and a handle to drag them by, and don't open.
  const [editing, setEditing] = useState(false);
  const syncTap = useSyncTap(props.sync, props.extra?.refresh);
  const backup = props.sync ? undefined : props.backup;
  const drag = useDeckDrag({
    decks: allDecks,
    shown,
    onMove: props.onMoveDeck,
    renderCard: (deck) => {
      const row = shown.find((r) => r.deck === deck);
      return row ? <DeckChip row={row} /> : null;
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
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" selected={syncTap.busy} tintColor={syncTap.busy ? c.accent : undefined} accessibilityLabel={syncTap.busy ? 'Syncing' : 'Sync now'} onPress={syncTap.tap} />
          ) : null}
          {!editing ? <Stack.Toolbar.Button icon="plus" accessibilityLabel="Quick add words" onPress={props.onQuickAdd} /> : null}
      {!editing ? <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Browse and search notes" onPress={props.onBrowse} /> : null}
          {!editing ? <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Decks settings" onPress={props.onSettings} /> : null}
          {/* What's used less often than adding to or opening a deck, so the bar stays at five buttons. */}
          {!editing ? <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More: new deck, edit decks or stats">
            <Stack.Toolbar.MenuAction icon="rectangle.stack.badge.plus" onPress={props.onNewDeck}>New deck</Stack.Toolbar.MenuAction>
            {groups.length ? <Stack.Toolbar.MenuAction icon="arrow.up.arrow.down" onPress={() => { setOpenDeck(null); setEditing(true); }}>Edit decks</Stack.Toolbar.MenuAction> : null}
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
          <RefreshControl refreshing={syncTap.pulling} onRefresh={syncTap.pull} tintColor={c.textSecondary} />
        )}
      >
        {/* Everything in one view, which a drag measures the rows against and draws its card in. */}
        <View {...drag.contentProps} style={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
          {/* What's for today (the day's count, extras, what needs doing) is on Today; this is every deck. */}
          {props.loadProblem ? (
            <WarningBanner title="Couldn't load your decks" detail={props.loadProblem.text} action="Tap to try again" hint="Loads the decks again" onPress={props.loadProblem.onRetry} />
          ) : null}
          {props.extra?.node}
          {groups.length === 0 ? (props.loaded === false ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : (
            <NoDecksCard onImport={props.onImport} />
          )) : (
            groups.map((g, gi) => (
              // Each family of decks settles in a beat after the one above, the first time the list shows.
              <Reveal key={g[0].deck} delay={settleDelay(gi)}>
              <Group>
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
                    <DeckRowLink
                      row={row}
                      first={i === 0}
                      toggleSlot={!!props.onToggleCollapsed}
                      open={openDeck === row.deck}
                      onOpenChange={(open) => setOpenDeck(open ? row.deck : null)}
                      onOptions={() => props.onOptions(row.deck)}
                      onMenu={() => props.onDeckMenu(row.deck)}
                      onAction={(action) => props.onDeckAction(row.deck, action)}
                      onToggle={props.onToggleCollapsed ? () => props.onToggleCollapsed!(row.deck) : undefined}
                      onStep={(by) => step(row.deck, by)}
                    />
                    )}
                  </View>
                ))}
              </Group>
              </Reveal>
            ))
          )}
          {props.sync ? (
            // Today warns when a sync didn't finish; here the line says why, in the warning color.
            // The line already counts the answers not synced yet (syncLine).
            <Pressable onPress={syncTap.tap} accessibilityRole="button" accessibilityHint="Syncs now"
              // A line of footnote text is about 18pt tall; the slop makes it a full tap target without moving the list.
              hitSlop={{ top: space.l, bottom: space.l }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: props.sync.failed ? c.warning : c.textSecondary, textAlign: 'center' }}>
                {props.sync.status}
              </Text>
            </Pressable>
          ) : props.ankiUnsent ? (
            <Pressable onPress={props.onImport} accessibilityRole="button" hitSlop={{ top: space.l, bottom: space.l }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>
                {props.ankiUnsent} {props.ankiUnsent === 1 ? "answer isn't" : "answers aren't"} in Anki yet. Tap to send.
              </Text>
            </Pressable>
          ) : null}
          {backup ? (
            <Text style={{ ...type.footnote, color: backup.overdue ? c.warning : c.textSecondary, textAlign: 'center' }}>{backup.text}</Text>
          ) : null}
          {drag.overlay}
        </View>
      </ScrollView>
      {syncTap.shown ? <SyncingPill top={header.top} /> : null}
      </View>
    </Screen>
  );
}
