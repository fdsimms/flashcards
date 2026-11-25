import React from 'react';
import { Text, View } from 'react-native';
import { talkSummary, type CramTalk as Talk } from '../../core/cram';
import type { Repo } from '../../db/repo';
import type { Language } from '../../reader/api';
import type { TextSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Card, Icon, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { TalkLine } from './TalkLine';

/**
 * A talking point on a cram's page. Folded, it's its title and what it holds ("2 to ask · 2 they may
 * ask · your story"); a tap opens it to the questions you ask, the ones the tutor may ask with your
 * answer, and your story, each read aloud when tapped (in the cram's language, when the words are in
 * one Read & Listen knows), with a word you hadn't studied underlined. The ⋯ button opens `onMenu`
 * (edit the story, remove it).
 */
export function CramTalk({ repo, talk, language, size, open, onToggle, onMenu }: {
  repo: Repo;
  talk: Talk;
  language: Language | undefined;
  size: TextSize;
  open: boolean;
  onToggle: () => void;
  onMenu: () => void;
}) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const info = language ? LANGUAGES[language] : undefined;
  const say = (text: string) => { if (info) phone.sayLine(text, info.speech, false); };
  const unknown = talk.unknown ?? [];
  const overline = { ...type.footnote, color: c.textSecondary, fontWeight: '600' as const };
  return (
    <Card style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Tappable onPress={() => { haptic.select(); onToggle(); }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={talk.title} style={{ flex: 1, gap: space.xs, minHeight: 44, justifyContent: 'center' }}>
          <Text style={overline}>{talk.title.toUpperCase()}</Text>
          {!open ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{talkSummary(talk)}</Text> : null}
        </Tappable>
        <Tappable onPress={onMenu} hitSlop={space.s} accessibilityRole="button" accessibilityLabel={`More for ${talk.title}`}>
          <Icon name="ellipsis.circle" size={22} color={c.accent} />
        </Tappable>
      </View>
      {open ? (
        <>
          {talk.questions.length ? <Text style={overline}>YOU ASK</Text> : null}
          {talk.questions.map((q) => <TalkLine key={q.text} text={q.text} english={q.english} language={language} size={size} unknown={unknown} onSay={say} />)}
          {talk.expects?.length ? <Text style={{ ...overline, paddingTop: space.xs }}>THEY MAY ASK YOU</Text> : null}
          {talk.expects?.map((e) => (
            <View key={e.question.text}>
              <TalkLine text={e.question.text} english={e.question.english} language={language} size={size} unknown={unknown} onSay={say} />
              <View style={{ borderLeftWidth: 3, borderLeftColor: c.accentFill, paddingLeft: space.s + 2, marginTop: 2 }}>
                <TalkLine text={e.answer.text} english={e.answer.english} language={language} size={size} unknown={unknown} onSay={say} scale={0.9} />
              </View>
            </View>
          ))}
          {talk.story ? (
            <>
              <Text style={{ ...overline, paddingTop: space.xs }}>YOUR STORY</Text>
              <TalkLine text={talk.story.text} english={talk.story.english} language={language} size={size} unknown={unknown} onSay={say} />
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

