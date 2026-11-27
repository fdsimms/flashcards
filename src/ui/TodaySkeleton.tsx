import React from 'react';
import { ScrollView, View } from 'react-native';
import { Card, Group } from './kit';
import { Pulse, SkeletonBar } from './Skeleton';
import { radius, space } from './theme';
import { TodayColumns } from './TodayColumns';

/**
 * What Today shows while its pieces are still arriving (`ready` false): placeholders in the shape
 * of the screen it turns into (the count card, the extras card, a deck group), so a cold start
 * isn't blank and nothing moves when the real content fades in. A ScrollView, like the real one,
 * so the large title sits and collapses the same way, and in the real screen's columns
 * (TodayColumns), so a wide screen's two don't shift either.
 */
export function TodaySkeleton() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" scrollEnabled={false}>
      <Pulse>
        <TodayColumns
          lead={(
                <Card>
                  <View style={{ flexDirection: 'row', gap: space.m }}>
                    <View style={{ flex: 1, alignItems: 'center', gap: space.s }}>
                      <SkeletonBar width={64} height={40} />
                      <SkeletonBar width={84} height={14} />
                    </View>
                    <View style={{ flex: 1, alignItems: 'center', gap: space.s }}>
                      <SkeletonBar width={40} height={40} />
                      <SkeletonBar width={84} height={14} />
                    </View>
                  </View>
                </Card>
          )}
          // Where the extras card sits in each layout: under the count in one column, the right column in two.
          crams={(
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <SkeletonBar width={120} height={18} />
                    <SkeletonBar width={70} height={14} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                    {[170, 140, 185, 160].map((w) => <SkeletonBar key={w} width={w} height={36} radiusSize={radius.pill} />)}
                  </View>
                </Card>
          )}
          decks={(
                <Group>
                  {[0, 1].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m }}>
                      <SkeletonBar width={44} height={44} radiusSize={radius.m} />
                      <View style={{ flex: 1 }}><SkeletonBar width={i ? '40%' : '55%'} height={16} /></View>
                      <SkeletonBar width={44} height={28} radiusSize={radius.pill} />
                      <SkeletonBar width={44} height={28} radiusSize={radius.pill} />
                    </View>
                  ))}
                </Group>
          )}
          extras={null}
        />
      </Pulse>
    </ScrollView>
  );
}
