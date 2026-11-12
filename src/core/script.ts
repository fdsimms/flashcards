/** True when `text` contains Thai script, which is hard to read at body size and gets a larger one. */
export const hasThai = (text: string): boolean => /[฀-๿]/.test(text);
