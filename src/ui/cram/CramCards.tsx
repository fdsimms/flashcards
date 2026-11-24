import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { studyDayKey } from '../../core/day';
import type { NoteStore } from '../../anki/noteService';
import { cramNotes, dayName, daysUntil, isAwaitingFinish, isDismissedToday, isRunning, practiceLabel, practiceSummary, type Cram } from '../../core/cram';
import { haptic } from '../haptics';
import { Button, Card, Icon, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';
import { saveCram, useCollection, useCramClock, useCrams } from '../useCrams';

/**
 * Today's cards for crams (src/core/cram.ts), under the day's count: one for each running cram,
 * saying how practice is going, with a button to practice (and, on the day itself, to start the
 * lesson); and once a cram's day is over, one asking which words were used. A tap anywhere else
 * opens the cram. Each has an X that hides it for the rest of the study day (`dismissedOn`). Nothing
 * shows without one.
 */
export function CramCards({ repo }: { repo: NoteStore }) {
  const { crams } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const shown = crams.filter((c) => (isRunning(c, now, H) || isAwaitingFinish(c, now, H)) && !isDismissedToday(c, now, H));
  if (!shown.length) return null;
  return <>{shown.map((c) => <CramCard key={c.id} repo={repo} cram={c} now={now} dayStartsAtHour={H} />)}</>;
}

function CramCard({ repo, cram, now, dayStartsAtHour: H }: { repo: NoteStore; cram: Cram; now: Date; dayStartsAtHour: number }) {
  const c = useTheme();
  const router = useRouter();
  const collection = useCollection(repo);
  const dismiss = () => { haptic.tap(); saveCram(repo, { ...cram, dismissedOn: studyDayKey(now, H) }).catch(() => undefined); };
  const dismissButton = (
    <Tappable onPress={dismiss} accessibilityRole="button" accessibilityLabel={`Dismiss ${cram.name} until tomorrow`} style={{ width: 44, height: 44, marginTop: -space.s, marginRight: -space.s, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="xmark" size={14} color={c.textSecondary} />
    </Tappable>
  );
  const open = () => { haptic.tap(); router.push({ pathname: '/cram', params: { id: cram.id } }); };
  if (isAwaitingFinish(cram, now, H)) {
    return (
      <Card style={{ borderColor: c.accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`How did ${cram.name} go? Opens the cram.`} style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...type.headline, color: c.text }}>{`How did ${cram.name} go?`}</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Check off the words you used. The rest go into your next cram.</Text>
          </Pressable>
          {dismissButton}
        </View>
        <Button label="Check off words" onPress={() => { haptic.tap(); router.push({ pathname: '/cram-lesson', params: { id: cram.id } }); }} />
      </Card>
    );
  }
  const ids = cramNotes(cram, collection.notes).map((n) => n.id);
  const summary = collection.loaded ? practiceSummary(cram, ids) : '';
  const today = daysUntil(cram, now, H) === 0;
  return (
    <Card style={{ borderColor: c.accent }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Cram for ${cram.name}, ${dayName(cram, now, H)}. ${summary} Opens the cram.`} style={{ flex: 1, gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{`Cram for ${cram.name}`}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{dayName(cram, now, H)}</Text>
            <Icon name="chevron.right" size={13} color={c.textTertiary} weight="semibold" />
          </View>
          {summary ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{summary}</Text> : null}
        </Pressable>
        {dismissButton}
      </View>
      {collection.loaded && (ids.length || cram.phrases?.length) ? (
        <Button label={practiceLabel(cram, ids, cram.phrases?.length ?? 0)} variant={today ? 'secondary' : 'primary'} onPress={() => { haptic.tap(); router.push({ pathname: '/cram-round', params: { id: cram.id } }); }} />
      ) : null}
      {today ? <Button label="Start the lesson" onPress={() => { haptic.tap(); router.push({ pathname: '/cram-lesson', params: { id: cram.id } }); }} /> : null}
    </Card>
  );
}
