import { expect, test } from 'vitest';
import { thaiToneMarks } from '../../src/reader/thaiTones';

test('each of the five tones becomes its accent mark, and mid is left plain', () => {
  expect(thaiToneMarks('/hen˩˩˦/')).toBe('/hěn/');
  expect(thaiToneMarks('/kɔː˧/')).toBe('/kɔː/');
  expect(thaiToneMarks('/mai̯˥˩/')).toBe('/mâi̯/');
  expect(thaiToneMarks('/ma˦˥/')).toBe('/má/');
  expect(thaiToneMarks('/ma˨˩/')).toBe('/mà/');
});

test('the mark goes on the first vowel and the syllables stay separated', () => {
  expect(thaiToneMarks('/kʰaːw˥˩.nia̯w˩˩˦.ma˦˥.mua̯ŋ˥˩/')).toBe('/kʰâːw.nǐa̯w.má.mûa̯ŋ/');
  expect(thaiToneMarks('/hen˩˩˦.koŋ˧.t͡ɕak̚˨˩/')).toBe('/hěn.koŋ.t͡ɕàk̚/');
});

test('a vowel with no precomposed letter takes a combining mark', () => {
  expect(thaiToneMarks('/tʰɔːn˧/')).toBe('/tʰɔːn/');
  expect(thaiToneMarks('/pʰɔː˦˥/')).toBe('/pʰɔ́ː/');
});

test('IPA without tone letters, or with a tone it does not know, is left as it was', () => {
  expect(thaiToneMarks('/ˈkɔ.ʂu.la/')).toBe('/ˈkɔ.ʂu.la/');
  expect(thaiToneMarks('[ˈdomʲɪ]')).toBe('[ˈdomʲɪ]');
  expect(thaiToneMarks('/ma˥˥˨/')).toBe('/ma˥˥˨/');
  expect(thaiToneMarks('/ma˦˥.na/')).toBe('/ma˦˥.na/');
});
