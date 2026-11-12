import React from 'react';
import { useApp } from '../ui/AppContext';
import { Backup } from '../ui/Backup';

export default function BackupRoute() {
  const { repo } = useApp();
  return <Backup store={repo} />;
}
