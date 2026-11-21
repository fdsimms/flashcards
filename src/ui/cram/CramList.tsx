import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramNotes, dayName, isAwaitingFinish, isRunning, practiceSummary, type Cram } from '../../core/cram';
import { haptic } from '../haptics';
import { Group, Help, NavRow, Screen, SectionTitle } from '../kit';
import { readable, space, useTheme } from '../theme';
import { useCollection, useCramClock, useCrams } from '../useCrams';

/**
 * Practice, Cram: every cram, the ones coming up first, then those finished. The + button starts
 * one. With none yet, says what a cram is for.
 */
export function CramList({ repo }: { repo: NoteStore }) {
  const c = useTheme();
  const router = useRouter();
  const { crams, loaded } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const collection = useCollection(repo);
  const current = crams.filter((x) => !x.finishedAt).sort((a, b) => a.date.localeCompare(b.date));
  const past = crams.filter((x) => x.finishedAt).sort((a, b) => b.date.localeCompare(a.date));
  const open = (cram: Cram) => { haptic.tap(); router.push({ pathname: '/cram', params: { id: cram.id } }); };
  const detail = (cram: Cram) => {
    if (isAwaitingFinish(cram, now, H)) return 'Over. Check off the words you used.';
    if (isRunning(cram, now, H) && collection.loaded) return `${dayName(cram, now, H)}. ${practiceSummary(cram, cramNotes(cram, collection.notes).map((n) => n.id))}`;
    return dayName(cram, now, H);
  };
  return (
    <Screen
      title="Cram"
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="New cram" onPress={() => { haptic.tap(); router.push('/cram-edit'); }} />
        </Stack.Toolbar>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {loaded && !crams.length ? (
          <Help>
            Get ready for a tutor lesson or a trip: collect the words, questions and things to talk about, and practice them before the day. The words come up for review by then too. Tap + to start one.
          </Help>
        ) : null}
        {current.length ? (
          <Group>
            {current.map((cram, i) => (
              <NavRow key={cram.id} first={i === 0} icon={{ name: 'calendar', color: c.accent }} label={cram.name} detail={detail(cram)} onPress={() => open(cram)} />
            ))}
          </Group>
        ) : null}
        {past.length ? (
          <>
            <SectionTitle>Finished</SectionTitle>
            <Group>
              {past.map((cram, i) => (
                <NavRow
                  key={cram.id}
                  first={i === 0}
                  label={cram.name}
                  detail={`${dayName(cram, now, H)}. ${cram.used?.length ?? 0} of ${(cram.used?.length ?? 0) + (cram.unused?.length ?? 0)} words used.`}
                  onPress={() => open(cram)}
                />
              ))}
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
