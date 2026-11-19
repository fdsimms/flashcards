import React from 'react';
import { Text, View } from 'react-native';
import type { LessonReview } from '../../reader/api';
import { reviewDetail, reviewMinutes } from '../../reader/lessons';
import { Button, Card, ErrorNote } from '../kit';
import { radius, space, type, useTheme } from '../theme';

/**
 * The review on offer at the top of the Lessons tab (docs/read-and-listen/architecture.md, Audio
 * lessons): phrases noted in earlier lessons (Again, or answered slowly), made into a short lesson of
 * their own when asked for, like any lesson, and then in the list to play. Nothing here touches a card.
 */
export function LessonReviewCard({ review, onMake, busy, error }: { review: LessonReview; onMake: () => void; busy: boolean; error: string | null }) {
  const c = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.headline, color: c.text }}>Review</Text>
        <Chip label={`${reviewMinutes(review.phrases)} min`} gold />
      </View>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{reviewDetail(review)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {review.lessons.map((l) => <Chip key={l.title} label={`${l.title} · ${l.count}`} />)}
      </View>
      <Button label="Make the review" onPress={onMake} busy={busy} />
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}

function Chip({ label, gold }: { label: string; gold?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: space.s, borderRadius: radius.pill, backgroundColor: gold ? c.accentFill : c.fill }}>
      <Text style={{ ...type.caption, fontWeight: '600', color: gold ? c.accentInk : c.textSecondary }}>{label}</Text>
    </View>
  );
}
