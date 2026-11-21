import { router } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { TroubleCards } from '../ui/TroubleCards';

export default function TroubleRoute() {
  const { repo, syncSettings, openNoteEditor, reader: { api: readerApi } } = useApp();
  return (
    <TroubleCards
      repo={repo}
      agentFlags={!!syncSettings?.enabled}
      onEditNote={openNoteEditor}
      onCardInfo={(card) => router.push({ pathname: '/card-info', params: { card } })}
      suggestHints={readerApi ? (q) => readerApi.mnemonics(q) : undefined}
      fixFlaggedCard={readerApi ? (request) => readerApi.fixCard(request) : undefined}
    />
  );
}
