import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ApiError, type Api, type ExplainPoint, type GrammarChoice, type GrammarState, type LineGrammar } from '../reader/api';
import { GRAMMAR_CHOICES, grammarStateWord } from '../reader/grammar';
import { HeaderAction, Tappable, ErrorNote, Segments } from './kit';
import { haptic } from './haptics';
import { radius, space, type, useTheme } from './theme';

/**
 * A line's explanation, opened under it by the reader's explain button. It asks the server when it
 * mounts (the server writes it once and keeps it, so opening a line again costs nothing), and
 * "Explain more simply" asks for the plainer version. Under it, the grammar points the server found
 * in the line (docs/grammar.md, step 3). Nothing here grades a word or touches a card.
 * `grammarChosen` is what the reader has seen chosen this session, here or in a word's popover.
 */
export function LineExplanation({ api, textId, line, grammarChosen, onGrammarChosen, onOpenGrammar }: {
  api: Api;
  textId: number;
  line: number;
  grammarChosen: Record<string, GrammarChoice>;
  onGrammarChosen: (id: string, state: GrammarChoice) => void;
  /** Opens a grammar point's page. */
  onOpenGrammar: (id: string) => void;
}) {
  const c = useTheme();
  const [simple, setSimple] = useState(false);
  const [points, setPoints] = useState<ExplainPoint[] | null>(null);
  const [grammar, setGrammar] = useState<LineGrammar[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Counts requests, so an answer that arrives after a newer one was asked for (or after closing) is dropped.
  const latest = useRef(0);

  const load = async (wantSimple: boolean) => {
    const mine = ++latest.current;
    setError(null);
    setPoints(null);
    try {
      const answer = await api.explainLine(textId, line, wantSimple);
      if (latest.current === mine) { setPoints(answer.points); setGrammar(answer.grammar); setSimple(wantSimple); }
    } catch (e) {
      if (latest.current === mine) { setError(e instanceof Error ? e.message : String(e)); setSimple(wantSimple); }
    }
  };

  useEffect(() => {
    load(false);
    return () => { latest.current++; };
    // Asked once when the line's explanation opens.
  }, []);

  return (
    <View
      accessibilityLabel={`Explanation of line ${line + 1}`}
      style={{ marginTop: space.s, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.m, padding: space.m, gap: space.s }}
    >
      {error ? (
        <ErrorNote message={error} onRetry={() => load(simple)} />
      ) : points === null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ActivityIndicator />
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text>
        </View>
      ) : (
        <>
          {points.map((p, i) => (
            <Text key={i} style={{ ...type.subhead, color: c.text }}>
              <Text style={{ fontWeight: '700', color: c.accent }}>{p.phrase}</Text>
              {`: ${p.note}`}
            </Text>
          ))}
          {simple ? null : (
            <Tappable
              onPress={() => { haptic.tap(); load(true); }}
              accessibilityRole="button"
              accessibilityLabel="Explain more simply"
              style={{ alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
            >
              <Text style={{ ...type.footnote, color: c.text }}>Explain more simply</Text>
            </Tappable>
          )}
          <GrammarInLine api={api} grammar={grammar} chosen={grammarChosen} onChosen={onGrammarChosen} onOpen={onOpenGrammar} />
        </>
      )}
    </View>
  );
}

/**
 * "Grammar in this line": a chip for each point the server's finders found in it, with its choice.
 * Tapping one shows the point's note and the choice to change it there, as on the Grammar screen.
 */
function GrammarInLine({ api, grammar, chosen, onChosen, onOpen }: {
  api: Api;
  grammar: LineGrammar[];
  chosen: Record<string, GrammarChoice>;
  onChosen: (id: string, state: GrammarChoice) => void;
  onOpen: (id: string) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  // Changed here, while the server answers; it wins over what the line was explained with.
  const [changed, setChanged] = useState<Record<string, GrammarState>>({});
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  if (!grammar.length) return null;
  const stateOf = (g: LineGrammar): GrammarState => changed[g.id] ?? chosen[g.id] ?? g.state;

  const choose = async (g: LineGrammar, state: GrammarChoice) => {
    if (busy.current || stateOf(g) === state) return;
    busy.current = true;
    const before = stateOf(g);
    setError(null);
    setChanged((s) => ({ ...s, [g.id]: state }));
    try {
      await api.setGrammar(g.id, state);
      onChosen(g.id, state);
    } catch (e) {
      setChanged((s) => ({ ...s, [g.id]: before }));
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    } finally {
      busy.current = false;
    }
  };

  const shown = grammar.find((g) => g.id === open);
  return (
    <View style={{ gap: space.s, marginTop: space.xs }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>Grammar in this line</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {grammar.map((g) => (
          <Tappable
            key={g.id}
            onPress={() => { haptic.tap(); setError(null); setOpen(open === g.id ? null : g.id); }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === g.id }}
            accessibilityLabel={`${g.name}, ${grammarStateWord(stateOf(g))}`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: c.accentFill, borderRadius: radius.pill,
              paddingHorizontal: space.m, paddingVertical: space.xs, borderWidth: 2, borderColor: open === g.id ? c.accent : c.accentFill,
            }}
          >
            <Text style={{ ...type.footnote, fontWeight: '600', color: c.text }}>{g.name}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`· ${grammarStateWord(stateOf(g))}`}</Text>
          </Tappable>
        ))}
      </View>
      {shown ? (
        <View style={{ gap: space.s, paddingTop: space.s, borderTopWidth: 1, borderTopColor: c.border }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            <Text style={{ fontWeight: '600', color: c.text }}>{`${shown.name}.`}</Text>
            {` ${shown.note}.`}
          </Text>
          {/* A point not set yet has no segment selected. */}
          <Segments<GrammarChoice | 'unset'>
            options={GRAMMAR_CHOICES.map((s) => ({ ...s, accessibilityLabel: `${shown.name}: ${s.label}` }))}
            value={stateOf(shown)}
            onChange={(state) => { if (state !== 'unset') choose(shown, state); }}
          />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>Applies from the next text written.</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <HeaderAction label={`More about ${shown.name}`} onPress={() => onOpen(shown.id)} />
          </View>
        </View>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}
