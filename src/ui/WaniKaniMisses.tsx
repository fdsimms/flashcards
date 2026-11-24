import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { JAPANESE_FONT } from '../core/script';
import { missedItems } from '../wanikani/session';
import { primaryMeaning, readingGroups, type Subject } from '../wanikani/subjects';
import { haptic } from './haptics';
import { Tag } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';
import { HoverPressable } from './hover';

/** How many missed items the list shows before "Show all". */
const SHOWN = 5;

type Missed = ReturnType<typeof missedItems>[number];

/** The reading to show for an item: its first accepted one, none for a radical. */
function readingOf(subject: Subject): string {
  return readingGroups(subject)[0]?.readings[0] ?? '';
}

/** At a WaniKani session's end: the reviews answered wrong, with the meaning and reading and which one was missed. */
export function WaniKaniMissList({ missed, subjects }: { missed: Missed[]; subjects: Map<number, Subject> }) {
  const c = useTheme();
  const [all, setAll] = useState(false);
  const rows = missed.flatMap((m) => {
    const subject = subjects.get(m.subjectId);
    return subject ? [{ ...m, subject }] : [];
  });
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
          const meaning = primaryMeaning(r.subject);
          const reading = readingOf(r.subject);
          const missedOn = [r.wrongMeaning ? 'meaning' : '', r.wrongReading ? 'reading' : ''].filter(Boolean).join(' and ');
          return (
            <View
              key={r.assignmentId}
              accessible
              accessibilityLabel={`${r.subject.characters ?? 'Radical'}, ${meaning}${reading ? `, ${reading}` : ''}, missed on ${missedOn}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.m, paddingVertical: space.m, minHeight: 44, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityLanguage="ja-JP" style={{ ...type.body, fontFamily: JAPANESE_FONT, fontWeight: '600', color: c.text }}>{r.subject.characters ?? 'Radical picture'}</Text>
                <Text numberOfLines={2} style={{ ...type.subhead, color: c.textSecondary }}>{reading ? `${meaning} · ${reading}` : meaning}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: space.s }}>
                {r.wrongMeaning ? <Tag text="Meaning" color={c.danger} fill={c.dangerFill} /> : null}
                {r.wrongReading ? <Tag text="Reading" color={c.danger} fill={c.dangerFill} /> : null}
              </View>
            </View>
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
