/**
 * Live Omnilanguage note-type field order (28 fields), used to map a TSV export's columns when it
 * has no #columns header. It must match Anki exactly, or every field after a missing one lands a
 * column off: SuppressFrontCard was added after GenerateAudioCard and this list hadn't followed.
 */
export const omnilanguageFieldNames = [
  'Entry', 'Meaning', 'Audio', 'Context', 'ContextRomanized', 'ContextTranslation', 'Register', 'Dialect',
  'Notes', 'Etymology', 'Mnemonic', 'LeechHint', 'GenerateReverse', 'Language', 'GenerateAudioCard',
  'SuppressFrontCard', 'PartOfSpeech', 'Gender', 'Plural', 'Genitive', 'Classifier', 'Transliteration', 'KanaReading', 'Hanzi',
  'KeyForms', 'VerbClass', 'Auxiliary', 'AspectPartner',
];

/**
 * Omnilanguage's card templates in Anki's order, so an Anki card's `ord` names its kind. The
 * ordinal is the template's position, fixed whichever cards a note happens to generate.
 */
export const omnilanguageKindByOrd = ['forward', 'reverse', 'audio'] as const;
