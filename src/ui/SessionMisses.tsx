import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { ConfusedPair } from '../core/confusedPairs';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { missReasonsFor } from '../core/misses';
import type { AnswerRecord } from '../core/session';
import { missedCardText, type MissedCardText } from '../core/missedCard';
import type { Card, Note, NoteType } from '../core/types';
import type { Language } from '../reader/api';
import { missedPracticeLabel, mixupSet, practiceFromMisses, type MixupMode } from '../tools/mixups';
import { drillOfTags } from '../tools/skills';
import { haptic } from './haptics';
import { Icon, Tag } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';
import { HoverPressable } from './hover';

/** How many missed words the list shows before "Show all". */
const SHOWN = 5;

/** The first field with text in it, for a note whose first field is only a picture. */
function firstText(note: Note): string {
  for (const value of Object.values(note.fields)) {
    const text = htmlToText(value).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/** A skill drill's row: the language and step (the Front's first line) over what to do. */
function drillRow(note: Note, selfCheck: string): { word: string; meaning: string } {
  const title = htmlToText((note.fields.Front ?? '').split('</div>')[0]).replace(/\s+/g, ' ').trim();
  return { word: title || firstText(note), meaning: selfCheck };
}

export interface MixupRequest {
  noteIds: string[];
  mode: MixupMode;
  language: Language;
}

/**
 * At a session's end: the words answered Again, each with the reason chosen on Again's menu, and
 * what Similar words can practice of them (src/tools/mixups.ts): those missed on how a word
 * sounds by ear, the rest by meaning, each among the words it's confused with. Practicing changes
 * nothing about when the cards come back. `practicable` false (no route to the tool) offers none.
 * The practice is worked out only while `atEnd` (the screen that offers it is up): it reads every
 * studied word, and the cards change with each answer.
 */
export function useSessionMisses(history: AnswerRecord[], notes: Map<string, Note>, cards: Card[] | null, practicable: boolean, noteTypes: Map<string, NoteType>, pairs: ConfusedPair[], atEnd: boolean) {
  const missed = useMemo(() => history.filter((h) => h.rating === 1).map((h) => ({ noteId: h.before.noteId, kind: h.before.kind, cardId: h.before.id, miss: h.miss })), [history]);
  // An Anki note type's card once (its question and answer say which card), any other note once,
  // each with its latest reason.
  const rows = useMemo(() => {
    const latest = new Map<string, (typeof missed)[number] & { card?: MissedCardText }>();
    for (const m of missed) {
      const note = notes.get(m.noteId);
      // A skill drill has no card text (missedCardText), so it's listed like a word (see `drillRow`).
      const card = note ? missedCardText(note, noteTypes.get(note.model), m.kind) : undefined;
      const key = card ? m.cardId : m.noteId;
      latest.delete(key);
      latest.set(key, { ...m, card });
    }
    return [...latest].flatMap(([key, m]) => {
      const note = notes.get(m.noteId);
      if (!note) return [];
      const reason = m.miss ? missReasonsFor(note).find((r) => r.key === m.miss)?.label : undefined;
      const drill = drillOfTags(note.tags);
      const { word, meaning } = drill ? drillRow(note, drill.step.selfCheck) : { word: headword(note) || firstText(note), meaning: htmlToText(note.fields.Meaning ?? '').replace(/\s+/g, ' ').trim() };
      return [{ key, noteId: m.noteId, word, meaning, card: m.card, reason }];
    });
  }, [missed, notes, noteTypes]);
  const practice = useMemo(() => {
    if (!practicable || !atEnd || !missed.length || !cards) return [];
    const studied = new Set(cards.filter((card) => card.sched.state !== 0).map((card) => card.noteId));
    const labelOf = (key: string | undefined, noteId: string) => {
      const note = notes.get(noteId);
      return key && note ? missReasonsFor(note).find((r) => r.key === key)?.label : undefined;
    };
    return practiceFromMisses(missed, mixupSet(notes.values(), studied, pairs)).map((p) => ({
      label: missedPracticeLabel(p, labelOf(p.reason, p.noteIds[0])),
      request: { noteIds: p.noteIds, mode: p.mode, language: p.language } as MixupRequest,
    }));
  }, [practicable, atEnd, missed, notes, cards, pairs]);
  return { rows, practice };
}

export type SessionMissRow = ReturnType<typeof useSessionMisses>['rows'][number];

/** The list of words missed this session. */
export function SessionMissList({ rows, onOpen }: { rows: SessionMissRow[]; /** Opens a row's note to read or fix it; rows aren't tappable without it. */ onOpen?: (noteId: string) => void }) {
  const c = useTheme();
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Missed this session</Text>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{rows.length}</Text>
      </View>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.m, ...smooth, borderWidth: hairline, borderColor: c.border, overflow: 'hidden' }}>
        {shown.map((r, i) => {
          const spoken = `${r.card ? `${r.card.question}, ${r.card.answer}` : `${r.word}, ${r.meaning}`}${r.reason ? `, missed on ${r.reason.toLowerCase()}` : ''}`;
          const cardName = r.card?.cardName;
          return (
            <HoverPressable
              key={r.key}
              disabled={!onOpen}
              onPress={() => { haptic.tap(); onOpen?.(r.noteId); }}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={spoken}
              accessibilityHint={onOpen ? 'Opens the note' : undefined}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.m, paddingVertical: space.m, minHeight: 44,
                borderTopWidth: i ? hairline : 0, borderTopColor: c.border,
                backgroundColor: pressed ? c.fill : 'transparent',
              })}
            >
              <View style={{ flex: 1, gap: space.xs }}>
                {r.card ? <Text numberOfLines={2} style={{ ...type.footnote, color: c.textSecondary }}>{r.card.question}</Text> : null}
                <Text style={{ ...type.body, fontWeight: '600', color: c.text }}>{r.card ? r.card.answer : r.word}</Text>
                {!r.card && r.meaning ? <Text numberOfLines={2} style={{ ...type.subhead, color: c.textSecondary }}>{r.meaning}</Text> : null}
                {cardName || r.reason ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s, marginTop: space.xs }}>
                    {cardName ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{cardName}</Text> : null}
                    {r.reason ? <Tag text={r.reason} color={c.danger} fill={c.dangerFill} /> : null}
                  </View>
                ) : null}
              </View>
              {onOpen ? <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" /> : null}
            </HoverPressable>
          );
        })}
        {rows.length > SHOWN ? (
          <HoverPressable
            onPress={() => { haptic.select(); setAll((v) => !v); }}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: hairline, borderTopColor: c.border, backgroundColor: pressed ? c.fill : 'transparent' })}
          >
            <Text style={{ ...type.body, color: c.accentInk }}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Text>
          </HoverPressable>
        ) : null}
      </View>
    </View>
  );
}
