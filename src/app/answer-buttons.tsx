import React from 'react';
import { AnswerButtonsSettings } from '../ui/AnswerButtonsSettings';
import { useApp } from '../ui/AppContext';

/** Settings > Answer buttons: which of Again, Hard, Good and Easy Review shows. */
export default function AnswerButtonsRoute() {
  const { repo } = useApp();
  return <AnswerButtonsSettings repo={repo} />;
}
