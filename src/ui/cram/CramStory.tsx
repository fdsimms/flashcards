import React from 'react';
import { ScrollView } from 'react-native';
import { cramLanguageOf, withTalkStory, type CramLine } from '../../core/cram';
import type { Api } from '../../reader/api';
import type { AppRepo } from '../AppContext';
import { Help, Loading, Screen } from '../kit';
import { readable, space } from '../theme';
import { cramsNow, saveCram, useCollection, useCrams } from '../useCrams';
import { StoryEditor } from './StoryEditor';
import { useTalkSize } from './talkSize';
import { useKeyboardScroll } from '../useKeyboardScroll';

/**
 * A kept talking point's story, edited from the cram's page (its ⋯ menu): Claude checks the new
 * version and writes its English (`StoryEditor`), and it replaces the story on the cram
 * (`withTalkStory`), read as the cram is when it's saved.
 */
export function CramStory({ repo, api, id, title, onDone }: { repo: AppRepo; api: Api; id: string; title: string; onDone: () => void }) {
  const { crams, loaded } = useCrams(repo);
  const collection = useCollection(repo);
  const [size] = useTalkSize();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const cram = crams.find((x) => x.id === id);
  const story = cram?.themes?.find((t) => t.title === title)?.story;
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  if (!loaded || !collection.loaded) return <Screen title="Your story" largeTitle={false}><Loading /></Screen>;
  if (!cram || !story || !language) {
    return (
      <Screen title="Your story" largeTitle={false}>
        <ScrollView contentContainerStyle={{ ...readable, padding: space.l }}><Help>{!language && story ? "Choose the cram's language first (Edit, on its page)." : 'This talking point has no story anymore.'}</Help></ScrollView>
      </Screen>
    );
  }
  const save = async (line: CramLine) => {
    const now = cramsNow().find((x) => x.id === id) ?? cram;
    await saveCram(repo, withTalkStory(now, title, line));
    onDone();
  };
  return (
    <Screen title={title} largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} {...scrollProps}>
        <StoryEditor
          story={story}
          language={language}
          size={size}
          check={(attempt) => api.checkWriting({ kind: 'translate', language, attempt, english: story.english, reference: story.text })}
          onSave={save}
          onCancel={onDone}
        />
      </ScrollView>
    </Screen>
  );
}
