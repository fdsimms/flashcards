import React, { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SoFar } from '../../reader/api';
import { awayText, recapsShown, RECENT_EPISODES, WELCOME_BACK_DAYS } from '../../reader/welcomeBack';
import { haptic } from '../haptics';
import { Button, Card, Icon, SectionTitle, SheetHeader, Tappable, TextButton } from '../kit';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { XrayCard } from './ReaderXray';

/**
 * A series' "Story so far" (docs/read-and-listen/architecture.md, Stories, Welcome back): the English
 * recap of each episode told. `StorySoFar` is the card on the series page, open by itself after a
 * week away; `WelcomeBack` is the sheet an episode opens on in that case, before it plays.
 */

/** Episode numbers beside their recap sentences. */
function EpisodeRecaps({ recaps }: { recaps: SoFar['recaps'] }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s }}>
      {recaps.map((r) => (
        <View key={r.episode} style={{ flexDirection: 'row', gap: space.m }}>
          <Text style={{ ...type.footnote, color: c.textSecondary, width: 28, fontVariant: ['tabular-nums'] }}>{r.episode}</Text>
          <Text style={{ ...type.subhead, color: c.text, flex: 1, lineHeight: 21 }}>{r.recap}</Text>
        </View>
      ))}
    </View>
  );
}

export function StorySoFar({ soFar }: { soFar: SoFar }) {
  const c = useTheme();
  const away = soFar.away_days !== null && soFar.away_days >= WELCOME_BACK_DAYS;
  const [open, setOpen] = useState(away);
  const [all, setAll] = useState(false);
  if (soFar.recaps.length === 0) return null;
  const more = soFar.recaps.length > RECENT_EPISODES;
  return (
    <Card style={{ gap: space.s }}>
      <Tappable
        onPress={() => { haptic.select(); setOpen(!open); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Story so far, ${open ? 'hide' : 'show'}`}
        style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}
      >
        <Text style={{ ...type.overline, color: c.textSecondary, flex: 1 }}>
          {away && soFar.away_days !== null ? `Story so far · back after ${awayText(soFar.away_days)}` : 'Story so far'}
        </Text>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={12} color={c.accent} weight="semibold" />
      </Tappable>
      {open ? (
        <>
          <EpisodeRecaps recaps={recapsShown(soFar, all)} />
          {more ? (
            <TextButton label={all ? 'Latest episodes only' : `All ${soFar.recaps.length} episodes`} accessibilityState={{ expanded: all }} onPress={() => setAll(!all)} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/**
 * What an episode opens on after a week or more away: the story so far, who's who as of the episode before, and
 * a way into the episode. "Skip recap" closes it without starting the audio.
 */
export function WelcomeBack({ soFar, episode, onPlay, onClose }: {
  soFar: SoFar;
  episode: number;
  onPlay: () => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }}
      >
        <SheetHeader onClose={onClose}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>Welcome back</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {soFar.away_days !== null ? `You last finished an episode ${awayText(soFar.away_days)} ago. ` : ''}Here is the story up to episode {episode - 1}.
          </Text>
        </SheetHeader>
        <SectionTitle>Story so far</SectionTitle>
        <EpisodeRecaps recaps={soFar.recaps} />
        {soFar.characters.length > 0 ? <SectionTitle>Who's who</SectionTitle> : null}
        {soFar.characters.map((ch) => <XrayCard key={ch.name} character={ch} />)}
        <Button label={`Play episode ${episode}`} onPress={onPlay} style={{ marginTop: space.m }} />
        <Button label="Skip recap" variant="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
