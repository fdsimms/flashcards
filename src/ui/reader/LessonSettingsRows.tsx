import React from 'react';
import { azureVoiceName } from '../../core/voices';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import type { Particle } from '../../reader/lessons';
import { Card, Group, Help, NavRow, Segments } from '../kit';
import { useReaderPlayerHost } from '../useReaderPlayer';
import { LessonTurnSettings } from './LessonTurnSettings';

/** Settings, Lessons: how audio lessons sound. Kept here, with Read & Listen's other screens, because it reads its types. */
export function LessonSettingsRows({ readerOn, narrator, defaultNarrator, language, particle, onParticle, onOpen }: {
  readerOn: boolean;
  narrator: string;
  defaultNarrator?: string;
  language: Language;
  particle: Particle;
  onParticle: (particle: Particle) => void;
  onOpen: (route: string) => void;
}) {
  // The same settings as the lesson player's switches, held by the shared player (useLessonWaits, useLessonTurns).
  const { waits, turns } = useReaderPlayerHost();
  // Lessons are made by Read & Listen's server, so with it off there is nothing here to set.
  if (!readerOn) {
    return (
      <>
        <Group>
          <NavRow first label="Read & Listen" detail="Off. Audio lessons are made by its server" onPress={() => onOpen('/read-settings')} />
        </Group>
        <Help>Turn on Read & Listen to make audio lessons and choose how they sound.</Help>
      </>
    );
  }
  return (
    <>
      <Group>
        <NavRow first label="Narrator" detail={narrator || defaultNarrator ? azureVoiceName(narrator || defaultNarrator!) : "The server's own voice"} onPress={() => onOpen('/read-narrator')} />
      </Group>
      <Group>
        <LessonTurnSettings waits={waits} turns={turns} />
      </Group>
      <Help>
        The microphone is on only during a pause. Only its loudness is checked, to tell when you've stopped, and your answer stays on
        this iPhone and is deleted after it plays. While either setting is on, Bluetooth headphones sound like a phone call during a
        lesson. You can also change these on each lesson's screen.
      </Help>
      {language === 'th' ? (
        <Card>
          <Segments
            options={[
              { value: 'khrap', label: 'ครับ (khrap)', accessibilityLabel: "Khrap, a man's polite ending" },
              { value: 'kha', label: 'ค่ะ (kha)', accessibilityLabel: "Kha, a woman's polite ending" },
            ]}
            value={particle}
            onChange={onParticle}
          />
          <Help>
            Every phrase you learn ends with this polite word, said in {particle === 'khrap' ? "the man's" : "the woman's"} voice, and
            you play {particle === 'khrap' ? 'the man' : 'the woman'} in the conversation at the end. It applies to lessons you make from now on.
          </Help>
        </Card>
      ) : (
        <Help>{`The Thai polite ending is chosen here when lessons are in Thai. They're in ${LANGUAGES[language].name} now; change the language from the flag on the Lessons tab.`}</Help>
      )}
    </>
  );
}
