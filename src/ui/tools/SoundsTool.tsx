import React from 'react';
import { View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { SoundGuide } from '../SoundGuideScreen';
import { usePhoneSpeech } from '../usePhoneSpeech';
import type { ToolScreenProps } from './index';
import { ToolScreen, useToolLanguage } from './ToolScreen';

/** How it sounds (src/tools/soundGuides.ts) on the Practice tab: the language's guide, read and heard. Nothing is asked or marked. */
export function SoundsTool({ tool, repo }: ToolScreenProps) {
  const [language, setLanguage] = useToolLanguage(tool);
  const speech = usePhoneSpeech(repo);
  return (
    <ToolScreen tool={tool} language={language} onLanguage={setLanguage} shown={false} onRandomize={() => {}} onShow={() => {}} onMark={() => {}} footer={<View />}>
      <SoundGuide language={language} onSay={(word) => void speech.sayWord(word, LANGUAGES[language].speech)} />
    </ToolScreen>
  );
}
