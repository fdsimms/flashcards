import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteStore } from '../../anki/noteService';
import { LESSON_MAX_WORDS, lessonIsCurrent, lessonPhrases, type Cram } from '../../core/cram';
import { failureText } from '../../core/failure';
import type { Note } from '../../core/types';
import type { Api, AudioLesson, Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { loadNarrator, loadParticle } from '../../reader/lessonStorage';
import { lessonDetail, lessonsOffered, POLL_MS } from '../../reader/lessons';
import { haptic } from '../haptics';
import { NavRow } from '../kit';
import { useTheme } from '../theme';
import { saveCram } from '../useCrams';

/**
 * Listen, on a cram's page: an audio lesson from Read & Listen made from the cram's own words (each
 * asked in English, a pause to answer, then the native voice), to play with the screen locked.
 * Made once on a tap and kept in the cram; asked for again while it's being made; made again on a
 * tap once the words have changed. Off, with the reason, when Read & Listen is off or doesn't make
 * lessons in the cram's language.
 */
export function CramListen({ repo, api, cram, notes, language }: { repo: NoteStore; api: Api | null; cram: Cram; notes: Note[]; language?: Language }) {
  const c = useTheme();
  const router = useRouter();
  const [lesson, setLesson] = useState<AudioLesson | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const phrases = language ? lessonPhrases(notes, language) : [];
  const current = lessonIsCurrent(cram, phrases.map((p) => p.noteId));
  const lessonId = cram.lesson?.id;

  const load = useCallback(async () => {
    if (!api || !language || lessonId === undefined) { setLesson(null); return; }
    const { lessons } = await api.lessons(language);
    setLesson(lessons.find((l) => l.id === lessonId) ?? null);
  }, [api, language, lessonId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  // Asked for again while it's being made, as the lessons list does.
  useEffect(() => {
    if (lesson?.state !== 'making') return undefined;
    const t = setInterval(() => { load().catch(() => undefined); }, POLL_MS);
    return () => clearInterval(t);
  }, [lesson?.state, load]);

  // A second tap before the first is drawn would ask for (and pay for) a second lesson.
  const asking = useRef(false);
  const make = async () => {
    if (!api || !language || asking.current) return;
    asking.current = true;
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      const [narrator, particle] = await Promise.all([loadNarrator(), loadParticle()]);
      const id = await api.makeLesson(language, cram.name, narrator || undefined, language === 'th' ? particle : undefined, phrases.map(({ text, english }) => ({ text, english })));
      await saveCram(repo, { ...cram, lesson: { id, noteIds: phrases.map((p) => p.noteId) } });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't ask for the lesson.", next: 'Try again.' }));
    } finally {
      asking.current = false;
      setBusy(false);
    }
  };

  const open = () => {
    if (!lesson) return;
    haptic.tap();
    router.push({ pathname: '/read-lesson', params: { lesson: JSON.stringify(lesson) } });
  };

  const icon = { name: 'headphones' as const, color: c.violet };
  if (!api) return <NavRow icon={icon} label="Listen" detail="Off. Turn on Read & Listen in Settings to use it." disabled onPress={() => undefined} />;
  if (!language || !lessonsOffered(language)) {
    return <NavRow icon={icon} label="Listen" detail={language ? `Audio lessons aren't made in ${LANGUAGES[language].name} yet.` : 'Needs words in a language Read & Listen teaches.'} disabled onPress={() => undefined} />;
  }
  if (!phrases.length) return <NavRow icon={icon} label="Listen" detail="Add words with their meanings first." disabled onPress={() => undefined} />;
  const more = notes.length > LESSON_MAX_WORDS ? ` The first ${LESSON_MAX_WORDS} words.` : '';
  if (problem) return <NavRow icon={icon} label="Listen" detail={problem} onPress={make} />;
  if (busy) return <NavRow icon={icon} label="Listen" detail="Asking for the lesson." loading disabled onPress={() => undefined} />;
  if (!lesson || lesson.state === 'failed') {
    const why = lesson?.state === 'failed' ? `${lessonDetail(lesson)} Tap to try again.` : `Make an audio lesson from these words: asked in English, a pause to answer, then the ${LANGUAGES[language].name}. Plays with the screen locked.${more}`;
    return <NavRow icon={icon} label="Listen" detail={why} onPress={make} />;
  }
  if (lesson.state === 'making') return <NavRow icon={icon} label="Listen" detail={`Being made. ${lessonDetail(lesson)}`} disabled onPress={() => undefined} />;
  return (
    <NavRow
      icon={icon}
      label="Listen"
      detail={current ? lessonDetail(lesson) : `${lessonDetail(lesson)} Made before the words changed.`}
      onPress={open}
      action={current ? undefined : { icon: 'arrow.clockwise', label: 'Make it again with the words as they are now', onPress: make }}
    />
  );
}
