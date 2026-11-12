/**
 * One of `count` choices (0 to count - 1) at random, never `previous` again, so a Randomize
 * button always changes what's shown. `random` is Math.random's shape, for tests.
 */
export function pickOther(count: number, previous: number | undefined, random: () => number = Math.random): number {
  const i = Math.floor(random() * count);
  if (i !== previous || count < 2) return i;
  // Any other choice, evenly: the ones after the repeat, wrapping round.
  return (i + 1 + Math.floor(random() * (count - 1))) % count;
}
