import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, type Api, type Language, type LinesDrillOffer } from '../../reader/api';
import { linesDetail } from '../../reader/lessons';
import { Button, Card, ErrorNote, Segments } from '../kit';
import { space, type, useTheme } from '../theme';
import { Chip } from './LessonReviewCard';

/**
 * Lines from your reading on the Lessons tab, beside Review (server/reader line_drill.py): a lesson
 * of lines from texts read lately, asked for in English and answered by each line's own recording,
 * for saying aloud with the screen locked, at normal speed or with each line's slow recording. Asked for here and made in the background like any lesson,
 * then in the list to play. Nothing here touches a card.
 */
export function LinesDrillCard({ api, language, offer, narrator, particle, onMade }: {
  api: Api;
  language: Language;
  offer: LinesDrillOffer;
  narrator?: string;
  particle?: 'khrap' | 'kha';
  onMade: () => Promise<unknown>;
}) {
  const c = useTheme();
  const [busy, setBusy] = useState(false);
  // Each line answered by its slow recording.
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.makeLinesDrill(language, narrator, particle, slow);
      await onMade();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't ask for the drill. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Lines from your reading</Text>
        <Chip label={`${offer.minutes} min`} gold />
      </View>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{linesDetail(offer)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {offer.texts.map((t) => <Chip key={t.title} label={`${t.title} · ${t.count}`} />)}
      </View>
      <Segments<'normal' | 'slow'>
        options={[{ value: 'normal', label: 'Lines at normal speed' }, { value: 'slow', label: 'Slow lines' }]}
        value={slow ? 'slow' : 'normal'}
        onChange={(v) => setSlow(v === 'slow')}
      />
      <Button label="Make the drill" onPress={make} busy={busy} />
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
