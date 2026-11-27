import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { noteDetail } from '../core/noteDetail';
import { withThaiLineHeight } from '../core/script';
import type { Card, Note, NoteType } from '../core/types';
import type { Repo } from '../db/repo';
import { Button, Divider, Group, NavRow } from './kit';
import { SidePanel } from './SidePanel';
import { space, type, useTheme } from './theme';

const day = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * The note picked in Browse, beside the list on a wide window (SidePanel.tsx): every field with
 * something in it, its deck, note type and tags, and each of its cards with where it stands
 * (src/core/noteDetail.ts). A card's row opens Card info; Edit note opens the editor a tap on the
 * row opens on a phone, and Delete asks first, as the row's swipe does.
 */
export function BrowseNotePanel({ repo, note, cards, now, dayStartsAtHour, onEdit, onDelete, onCardInfo }: {
  repo: Repo;
  /** The note picked; none, and the panel says what it's for. */
  note: Note | undefined;
  cards: Card[];
  now: Date;
  dayStartsAtHour: number;
  onEdit: () => void;
  onDelete: () => void;
  onCardInfo: (cardId: string) => void;
}) {
  const c = useTheme();
  // For the cards' names (a note type's templates). Until read, a card is named by its position.
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType> | null>(null);
  useEffect(() => {
    let live = true;
    repo.listNoteTypes().then((types) => { if (live) setNoteTypes(types); }, () => undefined);
    return () => { live = false; };
  }, [repo]);
  const detail = useMemo(
    () => (note ? noteDetail(note, cards, noteTypes?.get(note.model), { now, dayStartsAtHour, formatDay: day }) : null),
    [note, cards, noteTypes, now, dayStartsAtHour],
  );
  if (!note || !detail) return <SidePanel label="Note" empty="Tap a note to see it here." />;
  const facts: [string, string][] = [['Deck', note.deck], ['Note type', note.model]];
  if (note.tags.length) facts.push(['Tags', note.tags.join(', ')]);
  return (
    <SidePanel
      label="Note"
      empty=""
      footer={(
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button label="Edit note" style={{ flex: 1 }} onPress={onEdit} />
          <Button variant="destructive" label="Delete" accessibilityLabel={`Delete ${detail.title || 'empty note'}`} onPress={onDelete} />
        </View>
      )}
    >
      <Text selectable style={{ ...withThaiLineHeight(type.cardBack, detail.title), color: c.text }}>{detail.title || '(empty)'}</Text>
      {detail.fields.length ? (
        <Group>
          {detail.fields.map((f, i) => (
            <View key={f.name} accessible accessibilityLabel={`${f.name}: ${f.value}`} style={{ paddingVertical: space.m, paddingHorizontal: space.l, gap: space.xs }}>
              {i === 0 ? null : <Divider inset={space.l} />}
              <Text style={{ ...type.caption, color: c.textSecondary }}>{f.name}</Text>
              <Text selectable style={{ ...withThaiLineHeight(type.body, f.value), color: c.text }}>{f.value}</Text>
            </View>
          ))}
        </Group>
      ) : null}
      <Group>
        {facts.map(([label, value], i) => (
          <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}>
            {i === 0 ? null : <Divider inset={space.l} />}
            <Text style={{ ...type.body, color: c.textSecondary }}>{label}</Text>
            <Text style={{ ...type.body, color: c.text, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
          </View>
        ))}
      </Group>
      {detail.cards.length ? (
        <>
          <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary, paddingTop: space.s }}>Cards</Text>
          <Group>
            {detail.cards.map((card, i) => <NavRow key={card.id} first={i === 0} label={card.type} detail={card.state} onPress={() => onCardInfo(card.id)} />)}
          </Group>
        </>
      ) : null}
    </SidePanel>
  );
}
