import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type GrammarChoice, type GrammarList } from '../reader/api';
import { DEFAULT_MAX_PRACTICE, grammarChoiceOptions, seenLine } from '../reader/grammar';
import { Card, ErrorNote, HeaderAction, Help, Icon, Screen, Segments, Tappable } from './kit';
import { space, type, useTheme } from './theme';

/**
 * The current language's grammar points, each practiced (used at least twice in every text), known
 * (allowed, and the least seen worked in), not known (kept out) or not set yet (allowed at most
 * twice a text, and marked in the reader). The stored states are practice, normal, avoid and none.
 * Under each, how often it came up in the texts read, and above them the known points the next
 * texts are asked to work in (docs/read-and-listen/architecture.md, Grammar).
 */


export function ReadGrammar({ api, dayStartsAtHour, onOpenPoint }: { api: Api; dayStartsAtHour: number; onOpenPoint: (id: string) => void }) {
  const c = useTheme();
  const [list, setList] = useState<GrammarList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.grammar());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the grammar list.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const choose = async (id: string, state: GrammarChoice) => {
    const before = list;
    setList((l) => l && { ...l, points: l.points.map((p) => (p.id === id ? { ...p, state } : p)) });
    setError(null);
    try {
      setList(await api.setGrammar(id, state));
    } catch (e) {
      setList(before);
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    }
  };

  const now = new Date();
  const points = list?.points ?? null;
  const least = (list?.least ?? []).map((id) => points?.find((p) => p.id === id)).filter((p) => p !== undefined);
  // At the limit the server refuses another Practice, so the suggestions don't offer one.
  const practicing = (points ?? []).filter((p) => p.state === 'practice');
  const max = list?.max_practice ?? DEFAULT_MAX_PRACTICE;
  const full = practicing.length >= max;
  return (
    <Screen title="Grammar">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Help>
          {`Practice: used at least twice in every text, at most ${max} at a time. Know it: used freely, and the ones you've seen least are worked into texts. Don't know it: kept out of texts. Not set: at most 2 uses in a text, underlined and explained. Applies from the next text written.`}
        </Help>
        {error ? <ErrorNote message={error} onRetry={points === null ? load : undefined} /> : null}
        {points === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {points && points.length === 0 ? <Help>There are no grammar points for this language yet.</Help> : null}
        {points && points.length > 0 ? (
          <Card style={{ gap: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s }}>
              <Text style={{ ...type.headline, color: c.text }}>Practicing</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${practicing.length} of ${max}`}</Text>
            </View>
            {practicing.length === 0 ? (
              <Text style={{ ...type.subhead, color: c.textSecondary }}>Nothing set to Practice. Pick a point below, or Practice one from the suggestions.</Text>
            ) : (
              <>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Used at least twice in every text. Remove sets a point to Know it.</Text>
                {practicing.map((p) => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingTop: space.s, borderTopWidth: 1, borderTopColor: c.border }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{p.name}</Text>
                      {p.seen ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{seenLine(p.seen, p.state, now, dayStartsAtHour, true)}</Text> : null}
                    </View>
                    <HeaderAction label="Remove" accessibilityLabel={`Remove ${p.name} from Practice`} onPress={() => choose(p.id, 'normal')} />
                  </View>
                ))}
              </>
            )}
          </Card>
        ) : null}
        {least.length > 0 ? (
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }}>Seen least of what you know</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>
              {full
                ? 'These are being worked into your next texts. Remove a practiced point above to practice one of these.'
                : 'These are being worked into your next texts. Practice one to see it in every text.'}
            </Text>
            {least.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingTop: space.s, borderTopWidth: 1, borderTopColor: c.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{p.name}</Text>
                  {p.seen ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{seenLine(p.seen, p.state, now, dayStartsAtHour, true)}</Text> : null}
                </View>
                {full ? null : <HeaderAction label="Practice" accessibilityLabel={`Practice ${p.name}`} onPress={() => choose(p.id, 'practice')} />}
              </View>
            ))}
          </Card>
        ) : null}
        {points && points.length > 0 ? (
          <Card style={{ paddingVertical: 0, gap: 0 }}>
            {points.map((p, i) => {
              const seen = seenLine(p.seen, p.state, now, dayStartsAtHour);
              return (
                <View key={p.id} style={{ paddingVertical: space.m, gap: space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                  {/* The name and note open the point's page (docs/grammar.md, step 4). */}
                  <Tappable
                    onPress={() => onOpenPoint(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}. ${p.note}. Opens its page`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
                  >
                    <View style={{ flex: 1, gap: space.xs }}>
                      <Text style={{ ...type.headline, color: c.text }}>{p.name}</Text>
                      <Text style={{ ...type.subhead, color: c.textSecondary }}>{p.note}</Text>
                    </View>
                    <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
                  </Tappable>
                  {seen ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{seen}</Text> : null}
                  {/* A point not set yet has no segment selected. */}
                  <Segments<GrammarChoice | 'unset'>
                    style={{ marginTop: space.s }}
                    options={grammarChoiceOptions(p.name, p.state, practicing.length, max)}
                    value={p.state}
                    onChange={(state) => { if (state !== 'unset') choose(p.id, state); }}
                  />
                </View>
              );
            })}
          </Card>
        ) : null}
        <Help>The server checks each text for these and rewrites one that misses, so most texts follow them.</Help>
      </ScrollView>
    </Screen>
  );
}
