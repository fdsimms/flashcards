import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { siblingStep, type DeckMove } from '../core/deckOrder';
import { deckListTotals, isInDeck, shownDeckRows, type DeckRow } from '../core/deckTree';
import { useDeckDrag } from './DeckDrag';
import { haptic } from './haptics';
import { Button, Card, Group, Icon, NavRow, Screen, SwipeToReveal, Tappable } from './kit';
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

function DeckRowView({ row, first, onOpen, onMenu, onToggle, onLift, onStep }: {
  row: ShownRow;
  first: boolean;
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
        minHeight: MIN_TAP + space.xl, paddingVertical: space.m, paddingRight: space.xs,
        // A subdeck sits under its parent, indented, with a guide line down its left.
        paddingLeft: space.l + row.depth * space.l,
        backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {first ? null : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: space.l + row.depth * space.l, right: 0, height: hairline, backgroundColor: c.border }} />}
      {row.depth > 0 ? (
        <View style={{ position: 'absolute', left: space.l + (row.depth - 1) * space.l + space.xs, top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: c.fill }} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ ...(row.depth === 0 ? type.headline : type.callout), color: c.text }}>{row.name}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{row.total.toLocaleString()} {row.total === 1 ? 'card' : 'cards'}</Text>
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
        accessibilityHint="Add a note, rename, options or delete"
        style={({ pressed }) => ({ width: MIN_TAP - 4, height: MIN_TAP, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.4 : 1 })}
      >
        <Icon name="ellipsis" size={18} color={c.textTertiary} weight="semibold" />
      </Pressable>
      {row.hasSubdecks && onToggle ? (
        // In the indent before the name, so a deck's name stays where it is whether or not it has subdecks.
        // Last in the row: a later sibling is hit-tested first, so earlier it would hide the hit slop under the name.
        <Tappable
          onPress={() => { haptic.select(); onToggle(); }}
          accessibilityRole="button"
          accessibilityLabel={`${row.collapsed ? 'Show' : 'Hide'} the subdecks of ${row.name}`}
          hitSlop={{ left: space.s, right: space.l }}
          scaleTo={0.85}
          dimTo={0.5}
          style={{
            position: 'absolute', left: row.depth * space.l, top: 0, bottom: 0, width: space.l + space.xs,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name={row.collapsed ? 'chevron.right' : 'chevron.down'} size={11} color={c.textTertiary} weight="semibold" />
        </Tappable>
      ) : null}
    </Pressable>
  );
}

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
}) {
  const c = useTheme();
  const shown = useMemo(() => shownDeckRows(props.decks, props.collapsed ?? new Set()), [props.decks, props.collapsed]);
  const groups = useMemo(() => groupByTopLevel(shown), [shown]);
  const allDecks = useMemo(() => props.decks.map((r) => r.deck), [props.decks]);
  // The deck whose row is slid open on its Options action; one at a time.
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  // The pull-down spinner is for a pull-down only. Tied to every sync, the one at launch scrolled
  // the list to show the spinner, and the large title flashed open and snapped shut.
  const [pulling, setPulling] = useState(false);
  const totals = useMemo(() => deckListTotals(props.decks), [props.decks]);
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
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" disabled={props.sync.syncing} accessibilityLabel={props.sync.syncing ? 'Syncing' : 'Sync now'} onPress={props.sync.onSync} />
          ) : null}
          <Stack.Toolbar.Button icon="folder.badge.plus" accessibilityLabel="New deck" onPress={props.onNewDeck} />
          <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Browse and search notes" onPress={props.onBrowse} />
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={props.onSettings} />
        </Stack.Toolbar>
      }
    >
      <ScrollView
        {...drag.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        // Pull down to sync, when sync is on. Always mounted: sync's settings load a moment after
        // the screen opens, and a refresh control added then moved the content down and showed the
        // large title that had been scrolled out of view at launch. Without sync a pull does nothing.
        refreshControl={(
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              try { await props.sync?.onSync(); } finally { setPulling(false); }
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
          {groups.length ? <TodaySummary due={totals.due} fresh={totals.fresh} /> : null}
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
                        first={i === 0}
                        // Tapping a row that's slid open closes it, rather than opening the deck.
                        onOpen={() => (openDeck === row.deck ? setOpenDeck(null) : props.onOpen(row.deck))}
                        onMenu={() => props.onDeckMenu(row.deck)}
                        onToggle={props.onToggleCollapsed ? () => props.onToggleCollapsed!(row.deck) : undefined}
                        onLift={(e) => { setOpenDeck(null); drag.begin(row.deck, e); }}
                        onStep={(by) => step(row.deck, by)}
                      />
                    </SwipeToReveal>
                  </View>
                ))}
              </Group>
            ))
          )}
          {props.sync ? (
            <Pressable onPress={props.sync.onSync} accessibilityRole="button" accessibilityHint="Syncs now"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, color: props.sync.failed ? c.warning : c.textSecondary, textAlign: 'center' }}>
                {props.sync.syncing ? 'Syncing…' : props.sync.status}
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
