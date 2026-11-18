/**
 * Runs `fn` once what was just committed is on screen: after two animation frames, or after
 * `fallbackMs` if frames stop coming (the app in the background), so work waiting on it, such as
 * an answer's write, isn't held up there. Returns a function that cancels it.
 */
export function afterPaint(fn: () => void, fallbackMs = 100): () => void {
  let done = false;
  let second = 0;
  const first = requestAnimationFrame(() => { second = requestAnimationFrame(run); });
  const timer = setTimeout(run, fallbackMs);
  function stop() {
    done = true;
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
    clearTimeout(timer);
  }
  function run() {
    if (done) return;
    stop();
    fn();
  }
  return stop;
}

/** `afterPaint` as a promise. */
export const painted = (fallbackMs?: number) => new Promise<void>((resolve) => { afterPaint(resolve, fallbackMs); });
