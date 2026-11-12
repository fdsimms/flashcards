import React from 'react';
import { useApp } from '../ui/AppContext';
import { Stats } from '../ui/Stats';

export default function StatsRoute() {
  const { repo } = useApp();
  return <Stats repo={repo} />;
}
