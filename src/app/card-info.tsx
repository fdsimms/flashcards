import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CardInfo } from '../ui/CardInfo';

/** Card Info for the card named by the `card` parameter (Franki's card id). */
export default function CardInfoRoute() {
  const { repo } = useApp();
  const { card } = useLocalSearchParams<{ card: string }>();
  return <CardInfo repo={repo} cardId={card} />;
}
