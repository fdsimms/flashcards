import React from 'react';
import { useApp } from '../ui/AppContext';
import { ThaiTextSettings } from '../ui/ThaiTextSettings';

/** Settings > Thai text size: how large Thai is on a card. */
export default function ThaiTextSizeRoute() {
  const { repo } = useApp();
  return <ThaiTextSettings repo={repo} />;
}
