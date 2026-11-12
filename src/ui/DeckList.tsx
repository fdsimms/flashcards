import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { deckListTotals, shownDeckRows, type DeckRow } from '../core/deckTree';
import { Button, Card, Group, Icon, NavRow, Screen } from './kit';
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

function DeckRowView({ row, first, onOpen, onOptions, onToggle }: { row: ShownRow; first: boolean; onOpen: () => void; onOptions: () => void; onToggle?: () => void }) {
  const c = useTheme();
  const atCap = row.gate && row.gate.inProgress >= row.gate.cap;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}: ${row.due} due, ${row.fresh} new`}
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
      {row.hasSubdecks && onToggle ? (
        // In the indent before the name, so a deck's name stays where it is whether or not it has subdecks.
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${row.collapsed ? 'Show' : 'Hide'} the subdecks of ${row.name}`}
          hitSlop={{ left: space.s, right: space.xs }}
          style={({ pressed }) => ({
            position: 'absolute', left: row.depth * space.l, top: 0, bottom: 0, width: space.l + space.xs,
            alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.4 : 1,
          })}
        >
          <Icon name={row.collapsed ? 'chevron.right' : 'chevron.down'} size={11} color={c.textTertiary} weight="semibold" />
        </Pressable>
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
        onPress={onOptions}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${row.name}`}
        style={({ pressed }) => ({ width: MIN_TAP - 4, height: MIN_TAP, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.4 : 1 })}
      >
        <Icon name="ellipsis" size={18} color={c.textTertiary} weight="semibold" />
      </Pressable>
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
  /** Answers given here and not yet in Anki: not synced, or (without sync) not sent back by file. */
  ankiUnsent?: number;
  /** Present when sync is on. */
  sync?: { syncing: boolean; status: string; failed: boolean; onSync: () => void };
  onOpen: (deck: string) => void;
  onImport: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onBrowse: () => void;
  onOptions: (deck: string) => void;
  /** Decks whose subdecks are hidden: Anki's own collapsed state, shared through sync. */
  collapsed?: Set<string>;
  onToggleCollapsed?: (deck: string) => void;
  /** Present when Read & Listen is on. */
  onRead?: () => void;
}) {
  const c = useTheme();
  const groups = useMemo(() => groupByTopLevel(shownDeckRows(props.decks, props.collapsed ?? new Set())), [props.decks, props.collapsed]);
  const totals = useMemo(() => deckListTotals(props.decks), [props.decks]);
  const backup = props.sync ? undefined : props.backup;
  return (
    <Screen
      title="Decks"
      toolbar={
        <Stack.Toolbar placement="right">
          {props.sync ? (
            <Stack.Toolbar.Button icon="arrow.triangle.2.circlepath" disabled={props.sync.syncing} accessibilityLabel={props.sync.syncing ? 'Syncing' : 'Sync now'} onPress={props.sync.onSync} />
          ) : null}
          <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Browse and search notes" onPress={props.onBrowse} />
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={props.onSettings} />
        </Stack.Toolbar>
      }
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}
        // Pull down to sync, when sync is on.
        refreshControl={props.sync ? <RefreshControl refreshing={props.sync.syncing} onRefresh={props.sync.onSync} tintColor={c.textSecondary} /> : undefined}
      >
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
        {groups.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
            <Icon name="tray" size={40} color={c.textTertiary} weight="regular" />
            <Text style={{ ...type.title, color: c.text, marginTop: space.s }}>No decks yet</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21, textAlign: 'center', marginBottom: space.m }}>
              Bring in your Anki collection, by syncing with your Anki server or from a file exported from AnkiMobile.
            </Text>
            <Button label="Set up Anki" onPress={props.onImport} style={{ alignSelf: 'stretch' }} />
          </Card>
        ) : (
          groups.map((g) => (
            <Group key={g[0].deck}>
              {g.map((row, i) => (
                <DeckRowView
                  key={row.deck}
                  row={row}
                  first={i === 0}
                  onOpen={() => props.onOpen(row.deck)}
                  onOptions={() => props.onOptions(row.deck)}
                  onToggle={props.onToggleCollapsed ? () => props.onToggleCollapsed!(row.deck) : undefined}
                />
              ))}
            </Group>
          ))
        )}
        {props.onRead ? (
          <Group>
            <NavRow first icon={{ name: 'book.fill', color: c.again }} label="Read & Listen" detail="Texts written from the words in your decks" onPress={props.onRead} />
          </Group>
        ) : null}
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
      </ScrollView>
    </Screen>
  );
}
