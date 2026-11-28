import { useRouter } from 'expo-router';
import React from 'react';
import { heldCounts } from '../reader/heldNotes';
import { bannerOf } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { Banner } from './kit';
import { Reveal } from './motion';
import { useTheme } from './theme';
import { useConnectionProblem } from './connection';
import { useHeldWords } from './held';
import { useNoteQueue } from './useNoteQueue';

/** What Today's note queue card says, or null with nothing queued (the card hides itself). */
export function useNoteQueueBanner() {
  const router = useRouter();
  const { reader } = useApp();
  const { queue } = useNoteQueue(reader.api);
  const held = useHeldWords();
  const problem = useConnectionProblem();
  const banner = reader.api ? bannerOf(queue, heldCounts(held), problem === 'server') : null;
  return banner ? { ...banner, open: () => router.push('/read-note-queue') } : null;
}

/** The card on Today: words waiting for Claude (held on the phone while offline, or with Claude), ready to review, or that it couldn't fill in. */
export function NoteQueueCard({ banner }: { banner: NonNullable<ReturnType<typeof useNoteQueueBanner>> }) {
  const c = useTheme();
  const { tone, message, hint } = banner;
  const icon = tone === 'ready' ? 'checkmark.circle.fill' : tone === 'waiting' ? 'clock' : 'exclamationmark.triangle.fill';
  const color = tone === 'ready' ? c.good : tone === 'waiting' ? c.textSecondary : c.warning;
  return (
    <Reveal>
      <Banner icon={icon} iconColor={color} title={message} hint={hint} onPress={banner.open} />
    </Reveal>
  );
}
