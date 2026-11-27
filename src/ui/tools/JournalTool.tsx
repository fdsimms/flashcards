import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { isOffline } from '../../core/held';
import type { JournalHome, Language } from '../../reader/api';
import { preview } from '../../reader/journal';
import { LANGUAGES } from '../../reader/languages';
import { useHeldJournal, heldJournal } from '../held';
import { homeCopy, journalDrafts, keepHomeCopy, useJournalDrafts } from '../journal/journalWork';
import { Button, Card, ErrorNote, Group, Help, Loading, NavRow, Tappable } from '../kit';
import { radius, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { ToolScreen, useToolLanguage } from './ToolScreen';

/** When an entry was written, as the list says it: Today, Yesterday, a weekday this week, else the date. */
function written(at: string, now: Date): string {
  const day = new Date(at);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(day)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return day.toLocaleDateString('en-US', { weekday: 'long' });
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The journal (src/reader/journal.ts) in the Practice tab: Write an entry, the day's idea with a few of the
 * words being learned, the mistakes the journal found most in the last 60 days, entries waiting to be checked,
 * and the entries kept. Read from Read & Listen's server; the last copy shows offline, where an entry can still
 * be written and is checked later. Nothing here grades a card.
 */
export function JournalTool({ tool, readerApi }: ToolScreenProps) {
  const c = useTheme();
  const router = useRouter();
  const [language, setLanguage] = useToolLanguage(tool);
  const [home, setHome] = useState<{ language: Language; home: JournalHome; copy: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const held = useHeldJournal().filter((h) => h.language === language);
  const draft = useJournalDrafts().find((d) => d.language === language && d.text.trim());
  const asking = useRef(0);

  const load = useCallback(async () => {
    if (!readerApi) return;
    const mine = ++asking.current;
    setError(null);
    try {
      const got = await readerApi.journal(language);
      if (asking.current !== mine) return;
      setHome({ language, home: got, copy: false });
      void keepHomeCopy(language, got);
    } catch (e) {
      if (asking.current !== mine) return;
      const kept = isOffline(e) ? await homeCopy(language) : null;
      if (asking.current !== mine) return;
      if (kept) setHome({ language, home: kept, copy: true });
      else setError(failureText(e, { what: "Couldn't open your journal.", next: 'Try again.' }));
    }
  }, [readerApi, language]);
  // Again each time it comes back into view: an entry checked or deleted changes it.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = home?.language === language ? home.home : null;
  const open = (params: Record<string, string>) => router.push({ pathname: '/journal-entry', params: { language, ...params } });
  const words = shown?.idea.words.map((w) => w.word).join('\n') ?? '';

  let content: React.ReactNode;
  if (!readerApi) {
    content = <Card><Help>The journal uses Read & Listen. Turn it on in Settings, Read & Listen.</Help></Card>;
  } else if (error && !shown) {
    content = <ErrorNote message={error} onRetry={() => void load()} />;
  } else if (!shown) {
    content = <Loading />;
  } else {
    const max = Math.max(1, ...shown.kinds.map((k) => k.count));
    content = (
      <View style={{ gap: space.l }}>
        {home?.copy ? <Help>{"Read & Listen can't be reached, so this is your journal as it was last opened. You can still write an entry: it's checked once it can be reached."}</Help> : null}
        {!shown.checks ? <Help>{"Claude isn't set up on the server, so entries can't be checked (ANTHROPIC_API_KEY in server/.env turns this on)."}</Help> : null}
        <Card style={{ gap: space.s }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>An idea, if you want one</Text>
          <Text style={{ ...type.body, color: c.text }}>{shown.idea.prompt}</Text>
          {shown.idea.words.length ? (
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Words you're learning: ${shown.idea.words.map((w) => w.word).join(', ')}`}</Text>
          ) : null}
          <Button label="Write about this" variant="secondary" onPress={() => open({ prompt: shown.idea.prompt, words })} />
        </Card>
        {shown.kinds.length ? (
          <Card style={{ gap: space.s }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ ...type.overline, color: c.textSecondary }}>What you keep getting wrong</Text>
              <Tappable onPress={() => router.push({ pathname: '/journal-mistakes', params: { language } })} accessibilityRole="button" accessibilityLabel="All your mistakes">
                <Text style={{ ...type.subhead, color: c.accentInk }}>All</Text>
              </Tappable>
            </View>
            {shown.kinds.slice(0, 3).map((k) => (
              <View key={k.group} accessible accessibilityLabel={`${k.name}, ${k.count} times`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{k.name}</Text>
                <View style={{ width: 60, height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
                  <View style={{ width: `${(k.count / max) * 100}%`, height: '100%', backgroundColor: c.danger }} />
                </View>
                <Text style={{ ...type.footnote, color: c.textSecondary, minWidth: 20, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{k.count}</Text>
              </View>
            ))}
          </Card>
        ) : null}
        {held.length ? (
          <Group>
            {held.map((h, i) => (
              <NavRow
                key={h.key}
                first={i === 0}
                label={preview(h.text)}
                detail={h.problem ?? 'Checked when Read & Listen can be reached.'}
                onPress={async () => {
                  if (!h.problem) return;
                  // A refused one goes back to being written, to check again; opened once it's the draft.
                  await journalDrafts.update((list) => [...list.filter((d) => d.language !== h.language), { language: h.language, text: h.text, prompt: h.prompt, key: h.key, entryId: h.entryId }]);
                  await heldJournal.update((list) => list.filter((x) => x.key !== h.key));
                  open({});
                }}
                disabled={!h.problem}
              />
            ))}
          </Group>
        ) : null}
        {shown.entries.length ? (
          <Group>
            {shown.entries.map((e, i) => (
              <NavRow
                key={e.id}
                first={i === 0}
                label={preview(e.text)}
                detail={`${written(e.created_at, new Date())} · ${e.sentences} ${e.sentences === 1 ? 'sentence' : 'sentences'} · ${e.fixed ? `${e.fixed} fixed` : 'all right'}`}
                onPress={() => open({ id: String(e.id) })}
                disabled={home?.copy}
              />
            ))}
          </Group>
        ) : (
          <Help>{`Write about anything in ${LANGUAGES[language].name}: your day, a message to a friend, what you're planning. Claude checks it sentence by sentence, and your entries are kept here.`}</Help>
        )}
      </View>
    );
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={setLanguage}
      shown={false}
      onRandomize={() => void load()}
      onShow={() => {}}
      onMark={() => {}}
      actions={readerApi ? { primary: { label: draft ? 'Go on with your entry' : 'Write an entry', onPress: () => open(draft ? {} : { words }) } } : undefined}
      footer={readerApi ? undefined : <View />}
    >
      {content}
    </ToolScreen>
  );
}
