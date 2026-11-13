import { describe, expect, it } from 'vitest';
import { errorDetail, failureText, Refusal } from '../../src/core/failure';

describe('errorDetail', () => {
  it("cuts an expo native error down to its cause, on one line, without the closing period", () => {
    const e = new Error("Call to function 'NativeStatement.finalizeAsync' has been rejected.\n→ Caused by: Error code 5: database is locked.");
    expect(errorDetail(e)).toBe('Error code 5: database is locked');
  });

  it('reads a thrown string, and says nothing for nothing', () => {
    expect(errorDetail('disk full')).toBe('disk full');
    expect(errorDetail(undefined)).toBe('');
    expect(errorDetail(new Error(''))).toBe('');
  });
});

describe('failureText', () => {
  it("shows a refusal as it is, after what failed", () => {
    expect(failureText(new Refusal('A deck called "Polski" already exists.'), { what: "Couldn't rename the deck.", next: 'Try again.' }))
      .toBe('Couldn\'t rename the deck. A deck called "Polski" already exists.');
    expect(failureText(new Refusal('No cards match.'), { next: 'Try again.' })).toBe('No cards match.');
  });

  it("puts an unexpected error's text last, in parentheses, after what to do", () => {
    expect(failureText(new Error('database is locked'), { what: "Couldn't save the note.", next: 'Try again.' }))
      .toBe("Couldn't save the note. Try again. (database is locked)");
  });

  it('leaves the parentheses out when the error says nothing', () => {
    expect(failureText(undefined, { next: 'Try again.' })).toBe('Try again.');
  });

  it("counts a subclass as a refusal", () => {
    class NoteRefused extends Refusal {}
    expect(failureText(new NoteRefused('The first field is empty.'), { what: "Couldn't save the note.", next: 'Try again.' }))
      .toBe("Couldn't save the note. The first field is empty.");
  });
});
