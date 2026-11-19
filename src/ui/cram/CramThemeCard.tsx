import React from 'react';
import { Text } from 'react-native';
import { Button, Card, Help } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * On a new cram's sheet: the way to ask for theme ideas, or, once a theme is picked, what was picked
 * (its title becomes the cram's name, its words the cram's first words). Pure display: the sheet
 * owns what picking and removing do.
 */
export function CramThemeCard({ picked, onSuggest, onRemove }: {
  /** The theme picked, with how many of the owner's words it brings; undefined before one is. */
  picked?: { title: string; words: number; questions: number };
  onSuggest: () => void;
  onRemove: () => void;
}) {
  const c = useTheme();
  if (!picked) {
    return (
      <Card style={{ gap: space.m }}>
        <Text style={{ ...type.headline, color: c.text }}>Not sure what to talk about?</Text>
        <Help>Get theme ideas from your words and what you've been missing.</Help>
        <Button label="Suggest themes" variant="secondary" onPress={onSuggest} />
      </Card>
    );
  }
  const words = `${picked.words} ${picked.words === 1 ? 'word' : 'words'}`;
  const questions = `${picked.questions} ${picked.questions === 1 ? 'question' : 'questions'}`;
  return (
    <Card style={{ gap: space.m }}>
      <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>THEME</Text>
      <Text style={{ ...type.headline, color: c.text }}>{picked.title}</Text>
      <Help>{`${words} from your deck and ${questions} to talk from, kept with the cram.`}</Help>
      <Button label="Change theme" variant="secondary" onPress={onSuggest} />
      <Button label="Remove theme" variant="secondary" onPress={onRemove} />
    </Card>
  );
}
