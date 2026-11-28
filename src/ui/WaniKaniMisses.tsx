import React from 'react';
import { Text, View } from 'react-native';
import { JAPANESE_FONT } from '../core/script';
import { missedItems } from '../wanikani/session';
import { primaryMeaning, readingGroups, type Subject } from '../wanikani/subjects';
import { Tag } from './kit';
import { space, type, useTheme } from './theme';
import { MISSED_ROW, MissedDivider, MissedList } from './MissedList';

type Missed = ReturnType<typeof missedItems>[number];

/** The reading to show for an item: its first accepted one, none for a radical. */
function readingOf(subject: Subject): string {
  return readingGroups(subject)[0]?.readings[0] ?? '';
}

/** At a WaniKani session's end: the reviews answered wrong, with the meaning and reading and which one was missed. */
export function WaniKaniMissList({ missed, subjects }: { missed: Missed[]; subjects: Map<number, Subject> }) {
  const c = useTheme();
  const rows = missed.flatMap((m) => {
    const subject = subjects.get(m.subjectId);
    return subject ? [{ ...m, subject }] : [];
  });
  return (
    <MissedList
      rows={rows}
      row={(r, first) => {
        const meaning = primaryMeaning(r.subject);
        const reading = readingOf(r.subject);
        const missedOn = [r.wrongMeaning ? 'meaning' : '', r.wrongReading ? 'reading' : ''].filter(Boolean).join(' and ');
        return (
          <View
            key={r.assignmentId}
            accessible
            accessibilityLabel={`${r.subject.characters ?? 'Radical'}, ${meaning}${reading ? `, ${reading}` : ''}, missed on ${missedOn}`}
            style={MISSED_ROW}
          >
            <MissedDivider first={first} />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text accessibilityLanguage="ja-JP" style={{ ...type.body, fontFamily: JAPANESE_FONT, fontWeight: '600', color: c.text }}>{r.subject.characters ?? 'Radical picture'}</Text>
              <Text numberOfLines={2} style={{ ...type.subhead, color: c.textSecondary }}>{reading ? `${meaning} · ${reading}` : meaning}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              {r.wrongMeaning ? <Tag text="Meaning" color={c.danger} fill={c.dangerFill} /> : null}
              {r.wrongReading ? <Tag text="Reading" color={c.danger} fill={c.dangerFill} /> : null}
            </View>
          </View>
        );
      }}
    />
  );
}
