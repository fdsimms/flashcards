import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme, type TextInputInstance } from 'react-native';
import { suggestTags, type TagSuggestion } from '../core/priority';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

const SUGGESTIONS = 4;

/** What was typed as one tag: no "#", commas or spaces (tags are stored space-separated). */
const clean = (text: string) => text.replace(/[#,\s]/g, '');

/**
 * Tags as tokens in one field, with the collection's tags suggested as you type. A space, a comma
 * or return turns the typed text into a token, and leaving the field does too, so typed text is
 * never dropped. The tokens scroll in their own area and the input stays on its own row below
 * them, so it's reachable however many are chosen. `counts` is every tag with its notes
 * (`tagCounts`).
 */
export function TagTokenField({ label, tags, onChange, counts, placeholder }: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  counts: TagSuggestion[];
  placeholder?: string;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => suggestTags(counts, text, tags, SUGGESTIONS), [counts, text, tags]);

  const add = (raw: string) => {
    const tag = clean(raw);
    setText('');
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    haptic.select();
    onChange([...tags, tag]);
  };
  const remove = (tag: string) => { haptic.select(); onChange(tags.filter((t) => t !== tag)); };

  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
      <View style={{ backgroundColor: c.fill, ...smooth, borderColor: focused ? c.accent : 'transparent', borderWidth: 1.5, borderRadius: radius.m, padding: space.s, gap: space.xs }}>
        {tags.length ? (
          <ScrollView style={{ maxHeight: 140 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }} nestedScrollEnabled>
            {tags.map((t) => (
              <Tappable
                key={t}
                onPress={() => remove(t)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${t}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 36, paddingLeft: space.m, paddingRight: space.s, borderRadius: radius.pill, backgroundColor: c.accentFill }}
              >
                <Text style={{ ...type.subhead, color: c.accentInk }}>{t}</Text>
                <Icon name="xmark" size={12} color={c.accentInk} weight="semibold" />
              </Tappable>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          ref={input}
          accessibilityLabel={label}
          value={text}
          onChangeText={(v) => (/[\s,]$/.test(v) && clean(v) ? add(v) : setText(v))}
          onSubmitEditing={() => add(text)}
          onKeyPress={(e) => { if (e.nativeEvent.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1)); }}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); add(text); }}
          placeholder={placeholder}
          placeholderTextColor={c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          style={{ ...type.body, color: c.text, minHeight: MIN_TAP - space.s, paddingHorizontal: space.xs, borderTopWidth: tags.length ? hairline : 0, borderTopColor: c.border }}
        />
      </View>
      {suggestions.length ? (
        <View style={{ backgroundColor: c.fill, ...smooth, borderRadius: radius.m, overflow: 'hidden' }}>
          {suggestions.map((s, i) => (
            <Tappable
              key={s.tag}
              onPress={() => { add(s.tag); input.current?.focus(); }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s.tag}, ${s.count} ${s.count === 1 ? 'note' : 'notes'}`}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, minHeight: MIN_TAP, paddingHorizontal: space.m, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
            >
              <Text style={{ ...type.body, color: c.text, flexShrink: 1 }} numberOfLines={1}>{s.tag}</Text>
              <Text style={{ ...type.subhead, color: c.textSecondary }}>{s.count} {s.count === 1 ? 'note' : 'notes'}</Text>
            </Tappable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
