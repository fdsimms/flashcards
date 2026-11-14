import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Api, FormPrimer, Language, Word } from '../reader/api';
import { aboutWord, pieces } from '../reader/formPrimer';
import { haptic } from './haptics';
import { ErrorNote, HeaderAction, Icon, Tappable } from './kit';
import { hairline, radius, space, type, useTheme } from './theme';
import { failureText } from '../core/failure';

/**
 * The chip under a tapped word's meaning that names its grammatical form ("instrumental case"). It
 * opens ReadFormSheet. The server picks the form from its own list for the line the word is in
 * (server/reader/.../forms.py), so a word with no form to note shows no chip.
 */
export function ReadFormChip({ name, onPress }: { name: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${name}. Open an explanation.`}
      scaleTo={0.96}
      hitSlop={{ top: space.m, bottom: space.m }}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: c.accentFill, borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: 2 }}
    >
      <Text style={{ ...type.footnote, color: c.accent }}>{name}</Text>
      <Icon name="chevron.right" size={10} color={c.accent} weight="semibold" />
    </Tappable>
  );
}

// Primers are static on the server, so one load per language is kept for the rest of the session.
const loaded = new Map<Language, FormPrimer[]>();

/** The primers of a language, loaded on first use. A failure isn't kept, so the next try asks again. */
function usePrimers(api: Api, language: Language) {
  const [primers, setPrimers] = useState<FormPrimer[] | null>(loaded.get(language) ?? null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.forms(language).then(
      (list) => { loaded.set(language, list); setPrimers(list); },
      (e) => setError(failureText(e, { what: "Couldn't load the explanation.", next: 'Try again.' })),
    );
  }, [api, language]);
  useEffect(() => { if (!loaded.has(language)) load(); }, [language, load]);
  return { primers, error, retry: load };
}

/** `*marked*` text with the marked parts highlighted, for an ending. */
function Marked({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const c = useTheme();
  return (
    <Text style={style}>
      {pieces(text).map((p, i) => (
        <Text key={i} style={p.marked ? { color: c.accent, fontWeight: '700', backgroundColor: c.accentFill } : undefined}>{p.text}</Text>
      ))}
    </Text>
  );
}

function Table({ table }: { table: NonNullable<FormPrimer['table']> }) {
  const c = useTheme();
  // The first column names the row, so it's wider than the endings beside it.
  const flex = (i: number) => (i === 0 ? 1.4 : 1);
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s }}>
      <View style={{ flexDirection: 'row', gap: space.s, paddingBottom: space.xs }}>
        {table.head.map((h, i) => <Text key={i} style={{ ...type.caption, flex: flex(i), color: c.textSecondary }}>{h}</Text>)}
      </View>
      {table.rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: space.s, paddingVertical: space.xs + 1, borderTopWidth: hairline, borderTopColor: c.border }}>
          {row.map((cell, i) => (
            <Marked key={i} text={cell} style={{ ...type.subhead, flex: flex(i), color: i === 0 ? c.textSecondary : c.text }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * What a word's grammatical form means, opened from its chip: a plain explanation, the endings or
 * pattern, examples, and what the form is in the word that was tapped. iOS's own page sheet, as the
 * leech hint sheet is. The explanation is fixed text written for each language (server/reader/.../
 * data/forms), never generated when it's opened. `onClose` ends the lookup, so it's the reader again.
 */
export function ReadFormSheet({ api, language, word, onClose }: { api: Api; language: Language; word: Word; onClose: () => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { primers, error, retry } = usePrimers(api, language);
  const form = word.form;
  if (!form) return null;
  const primer = primers?.find((p) => p.id === form.id) ?? null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: Math.max(insets.bottom, space.l), gap: space.l }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
          <Text accessibilityRole="header" style={{ ...type.title, color: c.text, flexShrink: 1 }}>{form.name.charAt(0).toUpperCase() + form.name.slice(1)}</Text>
          <HeaderAction label="Done" onPress={onClose} />
        </View>
        {primer ? (
          <>
            <Text style={{ ...type.body, color: c.text }}>{primer.summary}</Text>
            {primer.table ? <Table table={primer.table} /> : null}
            <View style={{ gap: space.xs }}>
              <Text style={{ ...type.overline, color: c.textSecondary }}>Examples</Text>
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, paddingHorizontal: space.m }}>
                {primer.examples.map((e, i) => (
                  <View key={i} style={{ paddingVertical: space.s, gap: 2, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: c.border }}>
                    <Marked text={e.text} style={{ ...type.body, color: c.text }} />
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{e.english}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : error ? (
          <ErrorNote message={error} onRetry={retry} />
        ) : primers ? (
          <Text style={{ ...type.subhead, color: c.textSecondary }}>There's no explanation for this form yet.</Text>
        ) : (
          <ActivityIndicator color={c.accent} />
        )}
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>In your text</Text>
          <Text style={{ ...type.body, color: c.text }}>{aboutWord(word, form.name)}</Text>
        </View>
      </ScrollView>
    </Modal>
  );
}
