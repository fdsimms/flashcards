import React, { useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, Text } from 'react-native';
import { problemText, WaniKaniError } from '../wanikani/api';
import { APPRENTICE_LIMIT_CHOICES, NEW_PER_DAY_CHOICES } from '../wanikani/prefs';
import { PRODUCTION_BATCH } from '../wanikani/productionService';
import { Button, Card, CheckRow, ErrorNote, Field, Group, Help, NavRow, Screen, SectionTitle, SwitchRow } from './kit';
import type { WaniKaniState } from './useWaniKani';
import { space, type, useTheme } from './theme';

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

  return (
    <Screen title="WaniKani">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }} keyboardShouldPersistTaps="handled">
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
              <Help>{`${wanikani.unsent} ${wanikani.unsent === 1 ? "answer hasn't" : "answers haven't"} reached WaniKani yet. Franki sends them when it can reach it.`}</Help>
            ) : null}
            <Button label="Turn off" variant="destructive" onPress={turnOff} />
            <Help>Turning it off forgets the token on this iPhone. Production cards already made stay in your deck.</Help>
          </Card>
        ) : (
          <Card>
            <Field
              label="API token"
              value={value}
              onChangeText={setValue}
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

        <SectionTitle>Answers</SectionTitle>
        <Group accessibilityRole="radiogroup">
          <CheckRow first label="Type the answer" hint="As on WaniKani. For a reading, romaji turns into kana as you type." selected={prefs.answer === 'type'} onPress={() => setPrefs({ answer: 'type' })} />
          <CheckRow label="Show the answer, then rate it" hint="Again or Good, like your other decks. Again counts as one wrong answer." selected={prefs.answer === 'flip'} onPress={() => setPrefs({ answer: 'flip' })} />
        </Group>
        <Group>
          <SwitchRow
            first
            label="Ask meaning and reading separately"
            hint="Two questions for each kanji and word, in any order, as on WaniKani. Off, one card asks both."
            value={prefs.separate}
            onValueChange={(separate) => setPrefs({ separate })}
          />
          <SwitchRow
            label="Play audio with the answer"
            hint="WaniKani's recording of a word, when its reading is shown."
            value={prefs.autoplay}
            onValueChange={(autoplay) => setPrefs({ autoplay })}
          />
        </Group>

        <SectionTitle>Lessons per day</SectionTitle>
        <Group accessibilityRole="radiogroup">
          {NEW_PER_DAY_CHOICES.map((n, i) => (
            <CheckRow key={n} first={i === 0} label={n ? String(n) : 'None'} selected={prefs.newPerDay === n} onPress={() => setPrefs({ newPerDay: n })} />
          ))}
        </Group>
        <Help>
          {`Lessons done on wanikani.com count toward the day's lessons too.${wanikani.on ? ` ${wanikani.startedToday} done today.` : ''}`}
        </Help>

        <SectionTitle>Apprentice limit</SectionTitle>
        <Group accessibilityRole="radiogroup">
          {APPRENTICE_LIMIT_CHOICES.map((n, i) => (
            <CheckRow key={n ?? 'none'} first={i === 0} label={n === null ? 'No limit' : String(n)} selected={prefs.maxApprentice === n} onPress={() => setPrefs({ maxApprentice: n })} />
          ))}
        </Group>
        <Help>
          {`Lessons aren't offered while more than this many items are at Apprentice. Reviews are never held back.${wanikani.on && wanikani.apprentice !== null ? ` ${wanikani.apprentice} at Apprentice now.` : ''}`}
        </Help>

        <SectionTitle>Production cards</SectionTitle>
        <Group>
          <SwitchRow
            first
            label="Make production cards"
            hint="When a word reaches Guru, it gets an English to Japanese card in your Anki deck, with WaniKani's recording. These are your own cards, scheduled like the rest of the deck; WaniKani never sees them."
            value={prefs.production}
            onValueChange={(production) => setPrefs({ production })}
          />
          {prefs.production ? (
            <NavRow label="Deck" detail={wanikani.productionDeck ?? 'Choose a deck'} onPress={chooseDeck} />
          ) : null}
        </Group>
        {prefs.production && wanikani.production.refused ? <ErrorNote message={`Couldn't make production cards. ${wanikani.production.refused}`} /> : null}
        {prefs.production && !wanikani.productionDeck ? (
          <Help>Choose the deck production cards go in. They're Omnilanguage notes with only the Reverse card.</Help>
        ) : null}
        {prefs.production && wanikani.production.waiting ? (
          <Help>{`${wanikani.production.waiting} more ${wanikani.production.waiting === 1 ? 'word is' : 'words are'} waiting. Franki makes ${PRODUCTION_BATCH} at a time, each time it checks WaniKani.`}</Help>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
