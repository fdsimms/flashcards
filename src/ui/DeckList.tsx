import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { DeckRow } from '../core/deckTree';
import { Button, Card, Count, Help, HeaderAction, Screen } from './kit';
import { radius, space, type, useTheme } from './theme';

/** Rows grouped under their top-level deck, so each family of decks sits in one card. */
function groupByTopLevel(rows: DeckRow[]): DeckRow[][] {
  const groups: DeckRow[][] = [];
  for (const r of rows) {
    if (r.depth === 0 || !groups.length) groups.push([r]);
    else groups[groups.length - 1].push(r);
  }
  return groups;
}

function DeckRowView({ row, first, onOpen, onOptions }: { row: DeckRow; first: boolean; onOpen: () => void; onOptions: () => void }) {
  const c = useTheme();
  const atCap = row.gate && row.gate.inProgress >= row.gate.cap;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}: ${row.due} due, ${row.fresh} new`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.s,
        paddingVertical: space.m, paddingRight: space.s,
        // A subdeck sits under its parent, indented, with a guide line down its left.
        paddingLeft: space.l + row.depth * space.l,
        borderTopWidth: first ? 0 : 1, borderTopColor: c.border,
        backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {row.depth > 0 ? (
        <View style={{ position: 'absolute', left: space.l + (row.depth - 1) * space.l + space.xs, top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: c.fill }} />
      ) : null}
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...(row.depth === 0 ? type.headline : type.callout), color: c.text }}>{row.name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: space.xs }}>
          <Count value={row.due} label="due" color={c.countDue} />
          <Count value={row.fresh} label="new" color={c.countNew} />
          <Text style={{ ...type.subhead, color: c.textTertiary }}>{row.total} total</Text>
        </View>
        {row.gate ? (
          // Under the cap, new cards come in; at it, they wait until cards are a week out.
          <Text style={{ ...type.footnote, color: atCap ? c.warning : c.textSecondary }}>
            {row.gate.inProgress} of {row.gate.cap} in progress{atCap ? ', new cards wait' : ''}
          </Text>
        ) : null}
      </View>
      <HeaderAction label="Options" onPress={onOptions} accessibilityLabel={`Options for ${row.name}`} />
    </Pressable>
  );
}

export function DeckList(props: {
  decks: DeckRow[];
  /** When the last backup was made, and whether another is due (`backupStatus`). */
  backup?: { text: string; overdue: boolean };
  /** Answers given here and not yet in Anki: not synced, or (without sync) not sent back by file. */
  ankiUnsent?: number;
  /** Present when sync is on. */
  sync?: { syncing: boolean; status: string; failed: boolean; onSync: () => void };
  onOpen: (deck: string) => void;
  onImport: () => void;
  onBackup: () => void;
  onStats: () => void;
  onOptions: (deck: string) => void;
}) {
  const c = useTheme();
  const groups = useMemo(() => groupByTopLevel(props.decks), [props.decks]);
  return (
    <Screen
      title="Decks"
      right={props.sync ? <HeaderAction label={props.sync.syncing ? 'Syncing…' : 'Sync'} onPress={props.sync.onSync} /> : undefined}
      footer={
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button label="Anki" onPress={props.onImport} style={{ flex: 1 }} />
          <Button label="Stats" variant="secondary" onPress={props.onStats} style={{ flex: 1 }} />
          <Button label="Backup" variant="secondary" onPress={props.onBackup} style={{ flex: 1 }} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        {props.backup?.overdue ? (
          <Pressable onPress={props.onBackup} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
            <View style={{ borderRadius: radius.l, borderWidth: 1, borderColor: c.warning, padding: space.m, gap: space.xs }}>
              <Text style={{ ...type.headline, color: c.warning }}>{props.backup.text}</Text>
              <Text style={{ ...type.subhead, color: c.textSecondary }}>Everything is stored only on this iPhone. Tap to back up now.</Text>
            </View>
          </Pressable>
        ) : null}
        {groups.length === 0 ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>No decks yet</Text>
            <Help>Tap Anki to bring in your collection, exported from AnkiMobile.</Help>
          </Card>
        ) : (
          groups.map((g) => (
            <View key={g[0].deck} style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.l, overflow: 'hidden' }}>
              {g.map((row, i) => (
                <DeckRowView
                  key={row.deck}
                  row={row}
                  first={i === 0}
                  onOpen={() => props.onOpen(row.deck)}
                  onOptions={() => props.onOptions(row.deck)}
                />
              ))}
            </View>
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
        {props.backup && !props.backup.overdue ? (
          <Text style={{ ...type.footnote, color: c.textTertiary, textAlign: 'center' }}>{props.backup.text}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
