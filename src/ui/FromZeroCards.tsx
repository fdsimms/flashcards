import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { meaningOf } from '../core/cram';
import { isInDeck } from '../core/deckTree';
import { failureText } from '../core/failure';
import { headword } from '../core/forms';
import { deckWords, FROM_ZERO_NEW_PER_DAY, pathSteps, textsReady, type DeckWord, type FromZero, type PathStep } from '../core/fromZero';
import { LANGUAGES } from '../reader/languages';
import { useApp } from './AppContext';
import { endFromZero, hidePath, makePathLesson, openFirstWords } from './fromZeroActions';
import { useFromZero } from './fromZeroStorage';
import { Card, Icon, Meter, Tappable, TextButton } from './kit';
import { LESSONS_PATH } from './tabPaths';
import { radius, space, type, useTheme } from './theme';
import { useCollection } from './useCrams';

/** The words of the deck a path is on, in the order they came, and whether each is studied. */
export function usePathWords(path: FromZero | undefined): { words: DeckWord[]; loaded: boolean } {
  const { repo } = useApp();
  const { notes, cards, loaded } = useCollection(repo);
  const words = useMemo(
    () => (path ? deckWords(notes, cards, (n) => isInDeck(n.deck, path.deck), headword, meaningOf) : []),
    [notes, cards, path],
  );
  return { words, loaded };
}

/**
 * Today's card for each language started from zero (src/core/fromZero.ts): the path's steps, what's done
 * and what's next, each a tap to it. Once texts can start the path ends, and the language's common-words
 * setting goes back as it was. Nothing here grades a card.
 */
export function FromZeroCards() {
  // A hidden path still ends when texts can start, so its card is mounted and draws nothing.
  const paths = useFromZero();
  return <>{paths.map((z) => <FromZeroCard key={z.language} path={z} />)}</>;
}

function FromZeroCard({ path }: { path: FromZero }) {
  const c = useTheme();
  const router = useRouter();
  const { reader } = useApp();
  const api = reader.api;
  const { words, loaded } = usePathWords(path);
  const [making, setMaking] = useState(false);
  const ending = useRef(false);
  const name = LANGUAGES[path.language].name;

  // Texts can start: the path is done, and the language's common words count as known again.
  useEffect(() => {
    if (!api || !loaded || ending.current || !textsReady(words)) return;
    ending.current = true;
    endFromZero(api, path).then((settings) => { if (settings) reader.setSettings(settings); }, () => { ending.current = false; });
  }, [api, loaded, words, path, reader]);

  if (path.hidden) return null;
  const steps = pathSteps(path, words, name, FROM_ZERO_NEW_PER_DAY);
  const lesson = async () => {
    if (!api || making) return;
    setMaking(true);
    try {
      await makePathLesson(api, path, words);
      router.push(LESSONS_PATH);
    } catch (e) {
      Alert.alert("Couldn't make the lesson", failureText(e, { next: 'Try again in a moment.' }));
    } finally {
      setMaking(false);
    }
  };
  const tap = (step: PathStep): (() => void) | undefined => {
    if (step.id === 'sounds') return () => router.push({ pathname: '/sounds', params: { language: path.language } });
    if (step.id === 'words' && step.state !== 'done' && api) return () => openFirstWords(router, path.deck, path.language);
    if (step.id === 'study' && step.state === 'now') return () => router.push({ pathname: '/review', params: { deck: path.deck } });
    if (step.id === 'lesson' && step.state === 'now' && api) return () => void lesson();
    return undefined;
  };

  return (
    <Card style={{ gap: 0, paddingVertical: space.s }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: space.s }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{`${name} from zero`}</Text>
        <TextButton label="Hide" accessibilityLabel={`Hide ${name} from zero`} onPress={() => void hidePath(path.language)} />
      </View>
      {steps.map((step, i) => {
        const onPress = tap(step);
        const body = (
          <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start', paddingVertical: space.s, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
            <StepMark state={step.state} n={i + 1} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.body, color: step.state === 'later' ? c.textSecondary : c.text }}>
                {step.id === 'lesson' && making ? 'Making the lesson' : step.title}
              </Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{step.detail}</Text>
              {step.progress !== undefined ? (
                <Meter value={step.progress} color={step.state === 'later' ? c.textDim : c.accent} style={{ marginTop: space.xs }} />
              ) : null}
            </View>
            {onPress ? <Icon name="chevron.right" size={13} color={c.textDim} /> : null}
          </View>
        );
        return onPress ? (
          <Tappable key={step.id} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${step.title}. ${step.detail}`}>{body}</Tappable>
        ) : <View key={step.id} accessible accessibilityLabel={`${step.title}. ${step.detail}`}>{body}</View>;
      })}
    </Card>
  );
}

function StepMark({ state, n }: { state: PathStep['state']; n: number }) {
  const c = useTheme();
  const size = 22;
  if (state === 'done') {
    return (
      <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: c.goodInk, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" size={12} color={c.onAccent} />
      </View>
    );
  }
  return (
    <View style={{ minWidth: size, minHeight: size, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'now' ? c.accent : undefined, borderWidth: state === 'now' ? 0 : 1.5, borderColor: c.border }}>
      <Text style={{ ...type.caption, fontWeight: '700', color: state === 'now' ? c.onAccent : c.textDim }}>{n}</Text>
    </View>
  );
}
