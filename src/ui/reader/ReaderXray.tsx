import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StoryCharacter } from '../../reader/api';
import { badgeLetter, firstSeen, xraySections } from '../../reader/xray';
import { SectionTitle, SheetHeader } from '../kit';
import { hairline, radius, space, type, useTheme, smooth } from '../theme';

/**
 * X-Ray (docs/read-and-listen/architecture.md, X-Ray): who a series' characters are, as far as the
 * episode being read, in a sheet the reader's header button opens. The characters in the open
 * episode come first. The server sends only what the episodes up to this one told, so the sheet
 * can't give away what happens later.
 */

/** One character: a badge with their initial, their name, what is known of them, and when they first appeared. */
export function XrayCard({ character }: { character: StoryCharacter }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${character.name}. ${character.description}. ${firstSeen(character)}.`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, borderColor: c.border, borderWidth: hairline }}
    >
      <View style={{ minWidth: 38, minHeight: 38, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...type.headline, color: c.accentInk }}>{badgeLetter(character.name)}</Text>
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.text }}>{character.name}</Text>
        <Text style={{ ...type.subhead, color: c.textBody }}>{character.description}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{firstSeen(character)}</Text>
      </View>
    </View>
  );
}

export function ReaderXray({ characters, episode, onClose }: {
  characters: StoryCharacter[];
  /** The open episode's number, for the line saying nothing later is shown. */
  episode?: number;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { here, earlier } = xraySections(characters);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }}
      >
        <SheetHeader onClose={onClose}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>Characters</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {episode ? `Up to episode ${episode}. Nothing later is shown.` : "Only what you've read so far."}
          </Text>
        </SheetHeader>
        {characters.length === 0 ? <Text style={{ ...type.body, color: c.textSecondary }}>No characters are listed yet.</Text> : null}
        {here.length > 0 ? <SectionTitle>In this episode</SectionTitle> : null}
        {here.map((ch) => <XrayCard key={ch.name} character={ch} />)}
        {earlier.length > 0 ? <SectionTitle>{here.length > 0 ? 'Earlier in the series' : 'Characters'}</SectionTitle> : null}
        {earlier.map((ch) => <XrayCard key={ch.name} character={ch} />)}
      </ScrollView>
    </Modal>
  );
}
