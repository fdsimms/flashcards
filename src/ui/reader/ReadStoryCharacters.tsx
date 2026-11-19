import React, { useState } from 'react';
import type { StoryCharacter } from '../../reader/api';
import { View } from 'react-native';
import { SectionTitle, Tappable } from '../kit';
import { space } from '../theme';
import { ReaderXray, XrayCard } from './ReaderXray';

/**
 * A series page's Characters: everyone the episodes read so far have introduced (X-Ray). Tapping
 * one opens the same sheet the reader has, which lists them all.
 */
export function ReadStoryCharacters({ characters, read }: { characters: StoryCharacter[]; read: number }) {
  const [open, setOpen] = useState(false);
  if (characters.length === 0) return null;
  return (
    <View style={{ gap: space.s }}>
      <SectionTitle>Characters</SectionTitle>
      {characters.map((ch) => (
        <Tappable key={ch.name} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityHint="Shows every character">
          <XrayCard character={ch} />
        </Tappable>
      ))}
      {open ? <ReaderXray characters={characters} episode={read} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}
