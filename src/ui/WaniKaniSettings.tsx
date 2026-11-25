import React, { useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, Text } from 'react-native';
import { problemText, WaniKaniError } from '../wanikani/api';
import { APPRENTICE_LIMIT_CHOICES, NEW_PER_DAY_CHOICES, parseLimit } from '../wanikani/prefs';
import { PRODUCTION_BATCH } from '../wanikani/productionService';
import { Button, Card, CheckRow, ErrorNote, Field, Group, Help, NavRow, Screen, Section, SECTION_GAP, SwitchRow } from './kit';
import type { WaniKaniState } from './useWaniKani';
import { space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Turning WaniKani on (its API token) or off, and its options: how answers are given, lessons a
 * day, and production cards. Like Read & Listen it's off until set up here, since it uses the
 * network (CLAUDE.md, Data flow).
 */
export function WaniKaniSettings({ wanikani, decks }: {
  wanikani: WaniKaniState;
  /** The Anki decks production cards can go in. */
  decks: string[];
}) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prefs, setPrefs } = wanikani;

  const signIn = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await wanikani.signIn(value);
      setValue('');
    } catch (e) {
      setError(problemText(e instanceof WaniKaniError ? e.problem : 'unavailable'));
    } finally {
      setBusy(false);
    }
  };

  // A number typed for a limit the choices don't cover; refused with the reason if it isn't a whole number of 1 or more.
  const askLimit = (title: string, message: string, current: number | null, set: (n: number) => void) => {
    Alert.prompt(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set', isPreferred: true,
          onPress: (text?: string) => {
            const n = parseLimit(text ?? '');
            if (n === null) Alert.alert("That isn't a limit", 'Enter a whole number of 1 or more, like 80.');
            else set(n);
          },
        },
      ],
      'plain-text', current !== null ? String(current) : '', 'number-pad',
    );
  };
  const customLimit = () => askLimit('Apprentice limit', 'Stop offering lessons once this many items are at Apprentice.', prefs.maxApprentice, (maxApprentice) => setPrefs({ maxApprentice }));
  const customLessons = () => askLimit('Lessons per day', 'The most lessons to offer in a study day.', prefs.newPerDay, (newPerDay) => setPrefs({ newPerDay }));
  const customLessonsOn = !NEW_PER_DAY_CHOICES.includes(prefs.newPerDay);

  const turnOff = () => {
    const n = wanikani.unsent;
    const unsentLine = n
      ? ` The ${n === 1 ? "answer that hasn't" : `${n} answers that haven't`} reached WaniKani yet ${n === 1 ? 'stays' : 'stay'} on this iPhone and ${n === 1 ? 'is' : 'are'} sent when you turn WaniKani back on.`
      : '';
    Alert.alert(
      'Turn off WaniKani?',
      `Franki forgets your API token on this iPhone. Production cards already made stay in your deck.${unsentLine}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: wanikani.signOut },
      ],
    );
  };

  const chooseDeck = () => {
    const options = [...decks, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Deck for production cards', options, cancelButtonIndex: decks.length }, (i) => {
      if (i < decks.length) setPrefs({ productionDeck: decks[i] });
    });
  };

  const bringBack = (subjectId: number, name: string) => {
    ActionSheetIOS.showActionSheetWithOptions({ title: name, options: ['Bring back', 'Cancel'], cancelButtonIndex: 1 }, (i) => {
      if (i === 0) wanikani.unskip(subjectId);
    });
  };

  return (
    <Screen title="WaniKani">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding, gap: SECTION_GAP }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
        <Card>
          <Help>
            Study your WaniKani reviews and lessons as a deck. Answers go to WaniKani, which keeps its own schedule,
            so your progress is the same on wanikani.com.
          </Help>
          <Help>Franki talks only to api.wanikani.com, and only once a token is entered here.</Help>
        </Card>
        {wanikani.on === null ? null : wanikani.on ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>WaniKani is on</Text>
            {wanikani.user ? <Help>{`Signed in as ${wanikani.user.username}, level ${wanikani.user.level}.`}</Help> : null}
            {wanikani.problem ? <ErrorNote message={problemText(wanikani.problem)} onRetry={() => wanikani.refresh(true)} /> : null}
            {wanikani.unsent ? (
              <Help>{`${wanikani.unsent} ${wanikani.unsent === 1 ? "answer hasn't" : "answers haven't"} reached WaniKani yet. Franki sends them once WaniKani answers.`}</Help>
            ) : null}
            <Button label="Turn off" variant="destructive" onPress={turnOff} />
          </Card>
        ) : (
          <Card>
            <Field
              label="API token"
              value={value}
              onChangeText={setValue}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={signIn}
            />
            <Help>
              {'On wanikani.com, open Settings, then API Tokens, and generate a token. Check "reviews:create" and "assignments:start" so Franki can send your answers and start lessons. Franki keeps the token in the Keychain.'}
            </Help>
            {error ? <ErrorNote message={error} /> : null}
            <Button label="Turn on" onPress={signIn} busy={busy} disabled={!value.trim()} />
          </Card>
        )}

        <Section title="Answers">
          <Group>
            <SwitchRow
              first
              label="Type the meaning"
              hint="As on WaniKani. When off, you see the answer and rate it Again or Good. Again sends WaniKani one wrong answer."
              value={prefs.typeMeaning}
              onValueChange={(typeMeaning) => setPrefs({ typeMeaning })}
            />
            <SwitchRow
              label="Type the reading"
              hint="Romaji turns into kana as you type. When off, you see the answer and rate it."
              value={prefs.typeReading}
              onValueChange={(typeReading) => setPrefs({ typeReading })}
            />
          </Group>
          <Group>
            <SwitchRow
              first
              label="Ask meaning and reading separately"
              hint="Ask for the meaning and the reading as two questions, as on WaniKani."
              value={prefs.separate}
              onValueChange={(separate) => setPrefs({ separate })}
            />
            <SwitchRow
              label="Play audio with the answer"
              hint="WaniKani's recording of a word, when its reading is shown."
              value={prefs.autoplay}
              onValueChange={(autoplay) => setPrefs({ autoplay })}
            />
            <SwitchRow
              label="Animate level ups"
              hint="Fade in the popup when a word moves to a new stage. Reduce Motion in iOS Settings turns this off too."
              value={prefs.stageAnimation}
              onValueChange={(stageAnimation) => setPrefs({ stageAnimation })}
            />
          </Group>
        </Section>

        <Section
          title="Lessons per day"
          footer={(
            <Help>
              {`Lessons done on wanikani.com count toward the day's lessons too.${wanikani.on ? ` ${wanikani.startedToday} done today.` : ''}`}
            </Help>
          )}
        >
          <Group accessibilityRole="radiogroup">
            {NEW_PER_DAY_CHOICES.map((n, i) => (
              <CheckRow key={n} first={i === 0} label={n ? String(n) : 'None'} selected={prefs.newPerDay === n} onPress={() => setPrefs({ newPerDay: n })} />
            ))}
            <CheckRow label={customLessonsOn ? `Custom: ${prefs.newPerDay}` : 'Custom'} hint="Enter any number." selected={customLessonsOn} onPress={customLessons} />
          </Group>
        </Section>

        <Section
          title="Apprentice limit"
          footer={(
            <Help>
              {`Stop offering lessons once this many items are at Apprentice. Reviews always show.${wanikani.on && wanikani.apprentice !== null ? ` ${wanikani.apprentice} at Apprentice now.` : ''}`}
            </Help>
          )}
        >
          <Group accessibilityRole="radiogroup">
            {APPRENTICE_LIMIT_CHOICES.map((n, i) => (
              <CheckRow key={n ?? 'none'} first={i === 0} label={n === null ? 'No limit' : String(n)} selected={prefs.maxApprentice === n} onPress={() => setPrefs({ maxApprentice: n })} />
            ))}
            <CheckRow
              label={prefs.maxApprentice !== null && !APPRENTICE_LIMIT_CHOICES.includes(prefs.maxApprentice) ? `Custom: ${prefs.maxApprentice}` : 'Custom'}
              hint="Enter any number."
              selected={prefs.maxApprentice !== null && !APPRENTICE_LIMIT_CHOICES.includes(prefs.maxApprentice)}
              onPress={customLimit}
            />
          </Group>
        </Section>

        {wanikani.skipped.length ? (
          <Section
            title="Skipped words"
            footer={<Help>These words don't come up in lessons or reviews on this iPhone. WaniKani still lists them, so they stay on wanikani.com. Tap one to bring it back.</Help>}
          >
              <Group>
                {wanikani.skipped.map((w, i) => (
                  <NavRow
                    key={w.subjectId}
                    first={i === 0}
                    label={w.characters || w.meaning}
                    detail={w.characters ? w.meaning : undefined}
                    onPress={() => bringBack(w.subjectId, w.characters || w.meaning)}
                  />
                ))}
              </Group>
          </Section>
        ) : null}

        <Section
          title="Production cards"
          footer={(
            <>
              {prefs.production && !wanikani.productionDeck ? (
                <Help>Choose the deck production cards go in. They're Omnilanguage notes with only the Reverse card.</Help>
              ) : null}
              {prefs.production && wanikani.production.waiting ? (
                <Help>{`${wanikani.production.waiting} more ${wanikani.production.waiting === 1 ? 'word is' : 'words are'} waiting. Franki makes ${PRODUCTION_BATCH} at a time, each time it checks WaniKani.`}</Help>
              ) : null}
            </>
          )}
        >
          <Group>
            <SwitchRow
              first
              label="Make production cards"
              hint="When a word reaches Guru, it gets an English to Japanese card in your Anki deck, with WaniKani's recording. They're scheduled like your other cards, not by WaniKani."
              value={prefs.production}
              onValueChange={(production) => setPrefs({ production })}
            />
            {prefs.production ? (
              <NavRow label="Deck" detail={wanikani.productionDeck ?? 'Choose a deck'} onPress={chooseDeck} />
            ) : null}
          </Group>
          {prefs.production && wanikani.production.refused ? <ErrorNote message={`Couldn't make production cards. ${wanikani.production.refused}`} /> : null}
        </Section>
      </ScrollView>
    </Screen>
  );
}
