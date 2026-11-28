import React from 'react';
import { Text, View } from 'react-native';
import type { LessonReview } from '../../reader/api';
import { reviewDetail, reviewMinutes } from '../../reader/lessons';
import { Button, Card, ErrorNote, Tag } from '../kit';
import { space, type, useTheme } from '../theme';

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
        <Tag text={`${reviewMinutes(review.phrases)} min`} color={c.accentInk} fill={c.accentFill} />
      </View>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{reviewDetail(review)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {review.lessons.map((l, i) => <Tag key={`${i}:${l.title}`} text={`${l.title} · ${l.count}`} color={c.textSecondary} fill={c.fill} />)}
      </View>
      <Button label="Make the review" onPress={onMake} busy={busy} />
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}

