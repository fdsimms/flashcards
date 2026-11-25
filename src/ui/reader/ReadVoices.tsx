import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { failureText } from '../../core/failure';
import { azureVoiceName } from '../../core/voices';
import type { Api, Language, Settings, Speakers } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { hasVoiceSlots, sharesVoice, VOICE_SLOTS } from '../../reader/voiceSlots';
import { ErrorNote, Group, Help, Loading, NavRow, Screen, Section, SECTION_GAP } from '../kit';
import { space, readable } from '../theme';

/**
 * The Azure voices a language's texts are read in, by gender: a man's and a woman's, and a second
 * of each for a dialogue between two men or two women. Each row opens its list (ReadVoicePick).
 * The server keeps the choice; the texts waiting to be read are recorded again in it, and a text
 * already read keeps its audio.
 */
export function ReadVoices({ api, language, voices, onSettings, onPick, onCast }: {
  api: Api;
  language: Language;
  /** The language's voices as the app last had them from the server, if it has them yet. */
  voices: Partial<Speakers> | undefined;
  /** The settings as the server has them after a load, for the rest of the app. */
  onSettings: (settings: Settings) => void;
  onPick: (slot: keyof Speakers) => void;
  /** Opens the voices of a story's characters; none from a server that doesn't have them yet. */
  onCast?: () => void;
}) {
  const name = LANGUAGES[language].name;
  const [error, setError] = useState<string>();
  // Bumped by Try again, to ask for the settings again.
  const [attempt, setAttempt] = useState(0);
  const known = hasVoiceSlots(voices);

  useEffect(() => {
    if (known) return;
    let live = true;
    setError(undefined);
    api.settings().then(
      (s) => { if (live) onSettings(s); },
      (e) => { if (live) setError(failureText(e, { what: "Couldn't load the voices.", next: 'Try again.' })); },
    );
    return () => { live = false; };
  }, [api, known, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- onSettings is the app's setter

  // The settings loaded, but the server sends voices by speaker: it hasn't been updated yet.
  const outdated = !known && voices !== undefined;

  return (
    <Screen title={`${name} voices`}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        {error ? <ErrorNote message={error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {!known && voices === undefined && !error ? <Loading /> : null}
        {outdated ? <ErrorNote message="Your Read & Listen server hasn't been updated for this yet. It updates itself within about 15 minutes of a new version, so try again then." /> : null}
        {known ? (
          <Section
            footer={(
              <>
                <Help>
                  {`Texts use these voices for their speakers, with the second voice when both speakers are men or both are women. A story's narrator uses the man's voice.`}
                </Help>
                {sharesVoice(voices) ? (
                  <Help>{`A second voice that's the same as the first reads two men, or two women, in the same voice. Choose a different one to tell them apart.`}</Help>
                ) : null}
                <Help>
                  {`Texts waiting to be read are recorded again in the new voices; a text you've already read keeps its audio.`}
                </Help>
              </>
            )}
          >
            <Group>
              {VOICE_SLOTS.map((s, i) => (
                <NavRow key={s.slot} first={i === 0} label={s.label} detail={azureVoiceName(voices[s.slot])} onPress={() => onPick(s.slot)} />
              ))}
            </Group>
            {onCast ? (
              <Group>
                <NavRow first label="Series characters" detail="Voices for the people in a series" onPress={onCast} />
              </Group>
            ) : null}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
