/**
 * How a Practice question is answered, in the tools that can be heard as well as read: Say it
 * shows the question and its answer; Listen reads it aloud and checks what's set or typed.
 */
export const ANSWER_MODES = ['say', 'listen'] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];
