import { Stack } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { resolveFontFace } from '../../core/fonts';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { drawFromBag } from '../../tools/drillSeenStorage';
import type { Stroke } from '../../tools/ink';
import { randomWord } from '../../tools/script';
import { WRITING } from '../../tools/tools';
import { CURSIVE_LANGUAGES, writingHint, writingKind, writingKinds, writingStyle, type WritingItem, type WritingKind, type WritingMode, type WritingStyle } from '../../tools/writing';
import { haptic } from '../haptics';
import { Button } from '../kit';
import { CardSurface, type CardMotion } from '../SwipeCard';
import { radius, smooth, space, type, useTheme } from '../theme';
import { useWritingKanji } from '../useWritingKanji';
import type { ToolScreenProps } from './index';
import { Glyph, InkCopy, InkPad } from './InkPad';
import { MarkButtons, PracticeCard, useSwipeSetting } from './PracticeCard';
import { PlayButton, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODES: { value: WritingMode; label: string }[] = [{ value: 'trace', label: 'Trace it' }, { value: 'memory', label: 'From memory' }];
const STYLES: { value: WritingStyle; label: string }[] = [{ value: 'printed', label: 'Printed' }, { value: 'cursive', label: 'Cursive' }];
/** Joined handwriting's face: Marck Script, bundled, whose Cyrillic has the handwritten shapes (т with three stems, г, д). */
const CURSIVE_FACE = resolveFontFace('marckScript', 400);
const KINDS: Record<WritingKind, string> = { letters: 'Letters', words: 'Words', kanji: 'Kanji' };
const NAMES: Record<WritingKind, string> = { letters: 'The letter', words: 'The word', kanji: 'The kanji' };
/** The writing box's shape, width over height: a square for one letter or kanji, wider for a word. */
const ASPECT: Record<WritingKind, number> = { letters: 1, words: 2, kanji: 1 };

/**
 * Writing by hand: the question says what to write (a letter's name, a word's sound and meaning,
 * a kanji's meaning and reading), and a finger writes it in the box, over the answer shown faintly
 * (Trace it) or in an empty box (From memory). Show answer puts the writing beside the real one,
 * to mark Missed it or Got it: nothing checks the writing itself. A new question leans toward
 * what was missed lately (useMarks), and one missed comes back a few questions later. Russian can
 * be written as printed or in joined handwriting (Cursive), which changes only the face the
 * answer is drawn in.
 *
 * Until the answer shows, the card is a plain sheet rather than PracticeCard, whose scroll view
 * and swipe would take a stroke for their own; the screen's swipe back is off throughout for the
 * same reason.
 */
export function WritingTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<number>();
  const [mode, setMode] = useToolPref('writingMode');
  const [savedKind, setKind] = useToolPref('writingKind');
  const [savedStyle, setStyle] = useToolPref('writingStyle');
  const style = writingStyle(savedStyle, language);
  const face = style === 'cursive' ? CURSIVE_FACE : undefined;
  const kanji = useWritingKanji();
  const writing = WRITING[language];
  const kinds = writing ? writingKinds(writing, language === 'ja' ? kanji : []) : [];
  const kind = writingKind(savedKind, kinds);
  const items: WritingItem[] = !writing || !kind ? [] : kind === 'kanji' ? kanji : writing[kind];
  // What the questions are drawn from: a question held for another language or kind isn't this one's.
  const scope = `${language}|${kind}|${items.length}`;

  // `asked` counts the questions, so one that comes round again is a new question to mark.
  const [held, setHeld] = useState<{ scope: string; index: number; asked: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // A ref, not state: a second tap lands before the first one's render, and must see it was marked.
  const marked = useRef<string | null>(null);
  const index = held?.scope === scope ? held.index : undefined;
  const item = index !== undefined ? items[index] : undefined;
  const key = `${scope}|${index}|${held?.asked}`;
  useEffect(() => {
    if (held?.scope === scope || !items.length) return;
    answer.hide();
    setStrokes([]);
    setHeld({ scope, index: drawFromBag(language, tool.id, () => randomWord(items.length), (i) => items[i].text), asked: (held?.asked ?? 0) + 1 });
  }, [held?.scope, scope]);

  const next = () => {
    if (!items.length) return;
    answer.hide();
    setStrokes([]);
    const draw = () => marks.pick(() => randomWord(items.length, index), (i) => items[i].patterns, (i) => items[i].text);
    setHeld({ scope, index: retries.next(scope, index === undefined ? undefined : String(index), draw), asked: (held?.asked ?? 0) + 1 });
  };
  const motion = useRef<CardMotion | null>(null);
  const mark = (right: boolean) => {
    if (!item || index === undefined || marked.current === key) return;
    marked.current = key;
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    marks.mark(item.patterns, right);
    if (!right) retries.missed(scope, String(index), index);
    next();
  };
  const play = () => { if (item) answer.speak({ text: item.say }); };
  const showAnswer = () => answer.show(item ? { text: item.say } : undefined);
  const swipeOn = useSwipeSetting(repo);

  // The room the box may take, measured: its size follows from that and its shape, so a short screen gets a smaller box, never a clipped one.
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const aspect = kind ? ASPECT[kind] : 1;
  const pad = room ? { width: Math.floor(Math.min(room.width, room.height * aspect)), height: Math.floor(Math.min(room.height, room.width / aspect)) } : null;

  const menu: React.ReactNode[] = [(
    <Stack.Toolbar.Menu key="practice" inline title="Practice">
      {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) setMode(m.value); }}>{m.label}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
  )];
  if (kinds.length > 1) {
    menu.push((
      <Stack.Toolbar.Menu key="kind" inline title="Write">
        {kinds.map((k) => <Stack.Toolbar.MenuAction key={k} isOn={k === kind} onPress={() => { if (k !== kind) setKind(k); }}>{KINDS[k]}</Stack.Toolbar.MenuAction>)}
      </Stack.Toolbar.Menu>
    ));
  }

  if (CURSIVE_LANGUAGES.includes(language)) {
    menu.push((
      <Stack.Toolbar.Menu key="style" inline title="Handwriting">
        {STYLES.map((s) => <Stack.Toolbar.MenuAction key={s.value} isOn={s.value === style} onPress={() => { if (s.value !== style) setStyle(s.value); }}>{s.label}</Stack.Toolbar.MenuAction>)}
      </Stack.Toolbar.Menu>
    ));
  }

  const prompt = item ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text selectable accessibilityLanguage={kind === 'kanji' ? undefined : LANGUAGES[language].speech} style={{ ...type.title, color: c.text }}>{item.prompt}</Text>
        {item.detail ? <Text selectable style={{ ...type.subhead, color: c.textSecondary }}>{item.detail}</Text> : null}
      </View>
      <PlayButton label="Play it" onPress={play} />
    </View>
  ) : null;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={setLanguage}
      shown={answer.shown}
      onRandomize={next}
      onShow={showAnswer}
      onMark={mark}
      fill
      lockGesture
      menu={menu}
      footer={answer.shown ? <MarkButtons onMark={mark} /> : <Button label="Show answer" onPress={showAnswer} disabled={!item} />}
    >
      {answer.shown && item && kind ? (
        <PracticeCard
          questionKey={key}
          cardKey={`${key}|shown`}
          swipe={swipeOn}
          motion={motion}
          onMark={mark}
          front={prompt}
          back={<Compare item={item} kind={kind} language={language} strokes={strokes} pad={pad ?? { width: 1, height: 1 }} face={face} />}
        />
      ) : (
        <CardSurface>
          <View style={{ flex: 1, padding: space.xl, gap: space.l }}>
            {prompt}
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(e) => setRoom({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
              {pad && item ? <InkPad key={key} strokes={strokes} onChange={setStrokes} width={pad.width} height={pad.height} guide={mode === 'trace' ? item.text : undefined} face={face} language={language} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
              <Button variant="secondary" label="Undo" accessibilityLabel="Undo the last stroke" onPress={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} />
              {kind ? <Text style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1, textAlign: 'center' }}>{writingHint(kind, mode, false)}</Text> : null}
              <Button variant="secondary" label="Clear" accessibilityLabel="Clear the writing" onPress={() => setStrokes([])} disabled={!strokes.length} />
            </View>
          </View>
        </CardSurface>
      )}
    </ToolScreen>
  );
}

/** The writing beside the real one: side by side for a letter or a kanji, one over the other for a word, which is wide. */
function Compare({ item, kind, language, strokes, pad, face }: { item: WritingItem; kind: WritingKind; language: Language; strokes: Stroke[]; pad: { width: number; height: number }; face?: string }) {
  const c = useTheme();
  const wide = ASPECT[kind] > 1;
  return (
    <View style={{ flexDirection: wide ? 'column' : 'row', gap: space.m }}>
      <Tile label="Yours" aspect={ASPECT[kind]} wide={wide}>
        {() => <InkCopy strokes={strokes} pad={pad} aspect={ASPECT[kind]} />}
      </Tile>
      <Tile label={NAMES[kind]} aspect={ASPECT[kind]} wide={wide}>
        {(size) => <Glyph text={item.text} language={language} width={size.width} height={size.height} color={c.text} face={face} />}
      </Tile>
    </View>
  );
}

/** One frame of the comparison, with its label under it; its content is given the frame's measured size. */
function Tile({ label, aspect, wide, children }: { label: string; aspect: number; wide: boolean; children: (size: { width: number; height: number }) => React.ReactNode }) {
  const c = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View style={{ flex: wide ? undefined : 1, gap: space.xs }}>
      <View
        onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{ aspectRatio: aspect, borderRadius: radius.l, ...smooth, overflow: 'hidden', backgroundColor: c.fill }}
      >
        {size ? children(size) : null}
      </View>
      <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}
