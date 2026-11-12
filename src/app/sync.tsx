import React from 'react';
import { useApp } from '../ui/AppContext';
import { SyncSettings } from '../ui/SyncSettings';

export default function SyncRoute() {
  const { repo, syncSettings, syncing, sync, reloadSync } = useApp();
  return <SyncSettings repo={repo} settings={syncSettings} syncing={syncing} sync={sync} reload={reloadSync} />;
}
