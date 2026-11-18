import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { dayName, isAwaitingFinish, isRunning, roundStatus, type Cram } from '../../core/cram';
import { haptic } from '../haptics';
import { Button, Card, Icon } from '../kit';
import { space, type, useTheme } from '../theme';
import { useCramClock, useCrams } from '../useCrams';

/**
 * Today's cards for crams (src/core/cram.ts), under the day's count: one for each running cram,
 * saying when its next round is, with a button when one is ready; and once a cram's day is over,
 * one asking which words were used. A tap anywhere else opens the cram. Nothing shows without one.
 */
export function CramCards({ repo }: { repo: NoteStore }) {
  const { crams } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const shown = crams.filter((c) => isRunning(c, now, H) || isAwaitingFinish(c, now, H));
  if (!shown.length) return null;
  return <>{shown.map((c) => <CramCard key={c.id} cram={c} now={now} dayStartsAtHour={H} />)}</>;
}

function CramCard({ cram, now, dayStartsAtHour: H }: { cram: Cram; now: Date; dayStartsAtHour: number }) {
  const c = useTheme();
  const router = useRouter();
  const open = () => { haptic.tap(); router.push({ pathname: '/cram', params: { id: cram.id } }); };
  if (isAwaitingFinish(cram, now, H)) {
    return (
      <Card style={{ borderColor: c.accent }}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`How did ${cram.name} go? Opens the cram.`} style={{ gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.text }}>{`How did ${cram.name} go?`}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Check off the words you used. The rest go into your next cram.</Text>
        </Pressable>
        <Button label="Check off words" onPress={() => { haptic.tap(); router.push({ pathname: '/cram-used', params: { id: cram.id } }); }} />
      </Card>
    );
  }
  const status = roundStatus(cram, now, H);
  const missed = cram.rounds.at(-1)?.missed.length ?? 0;
  return (
    <Card style={{ borderColor: c.accent }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Cram for ${cram.name}, ${dayName(cram, now, H)}. ${status.text} Opens the cram.`} style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
          <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{`Cram for ${cram.name}`}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{dayName(cram, now, H)}</Text>
          <Icon name="chevron.right" size={13} color={c.textTertiary} weight="semibold" />
        </View>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>
          {missed ? `${status.text} You missed ${missed === 1 ? '1 word' : `${missed} words`} last round.` : status.text}
        </Text>
      </Pressable>
      {status.ready && status.action ? (
        <Button label={status.action} onPress={() => { haptic.tap(); router.push({ pathname: '/cram-round', params: { id: cram.id } }); }} />
      ) : null}
    </Card>
  );
}
