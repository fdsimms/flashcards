import React from 'react';
import { Text } from 'react-native';
import type { CramTalk as Talk } from '../../core/cram';
import type { Repo } from '../../db/repo';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { Card, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';
import { usePhoneSpeech } from '../usePhoneSpeech';

/**
 * A cram's theme on its page: the questions to steer the lesson with and the story to tell, each
 * read aloud when tapped (in the cram's language, when the words are in one Read & Listen knows).
 */
export function CramTalk({ repo, talk, language }: { repo: Repo; talk: Talk; language: Language | undefined }) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const info = language ? LANGUAGES[language] : undefined;
  const say = (text: string) => { if (info) phone.sayLine(text, info.speech, false); };
  return (
    <Card style={{ gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{talk.title.toUpperCase()}</Text>
      {talk.questions.map((q) => (
        <Tappable key={q.text} onPress={() => say(q.text)} disabled={!info} accessibilityRole="button" accessibilityLabel={`Hear ${q.text}`} style={{ gap: 2, paddingVertical: space.xs }}>
          <Text style={{ ...type.body, color: c.text }}>{q.text}</Text>
          {q.english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{q.english}</Text> : null}
        </Tappable>
      ))}
      {talk.story ? (
        <Tappable onPress={() => say(talk.story!.text)} disabled={!info} accessibilityRole="button" accessibilityLabel="Hear the story" style={{ gap: 2, paddingTop: space.s }}>
          <Text style={{ ...type.body, color: c.text }}>{talk.story.text}</Text>
          {talk.story.english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{talk.story.english}</Text> : null}
        </Tappable>
      ) : null}
    </Card>
  );
}
