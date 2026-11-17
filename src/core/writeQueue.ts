/**
 * Runs jobs one at a time, in the order they were added, off the caller's critical path.
 *
 * Review shows the next card as soon as an answer is worked out in memory, and writes it to the
 * database here. Each job runs after the one before it finishes, whether or not that one failed (a
 * job handles its own failure), so answers reach the database in the order they were given.
 * Anything that reads or undoes what an answer wrote calls `idle()` first.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;

  /** Jobs added and not yet finished. */
  get pending(): number {
    return this.count;
  }

  /** Adds a job. The returned promise settles with the job's own result. */
  add<T>(job: () => Promise<T>): Promise<T> {
    this.count++;
    const run = this.tail.then(job);
    const finished = () => { this.count--; };
    run.then(finished, finished);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Resolves once every job added so far has finished (a failed one included). */
  idle(): Promise<void> {
    return this.tail;
  }
}

/** The answers Review has shown but not finished writing. One for the app: a deck opened right after another reads after it. */
export const reviewWrites = new WriteQueue();
