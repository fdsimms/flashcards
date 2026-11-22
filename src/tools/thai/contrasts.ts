import type { ContrastSentence, ContrastSet, ContrastWord } from '../contrasts';

/*
 * Thai's Which word fits sets (src/tools/contrasts.ts). Each sentence is written as its words with
 * spaces between them, `_` for the gap and `/` where Thai puts a space between phrases; `ๆ` repeats
 * the word before it. Every word's romanization is written once, in ROMAN, in the deck's own system
 * (the Omnilanguage note guide: aa long, ue, ae/aae, aw/aaw, ə; a final ย as i, a final ว as o or u),
 * and tests/tools/contrasts.test.ts fails on a word missing from it.
 *
 * A sentence has to leave only one of the set's words natural in the gap. Hand-written; a Thai
 * speaker's check is worth more than the tests here.
 */

const ROMAN: Record<string, string> = {
  // The sets' own words.
  'จน': 'jon', 'จนกว่า': 'jon-gwàa', 'รู้': 'rúu', 'รู้จัก': 'rúu-jàk', 'หนาว': 'nǎao', 'เย็น': 'yen',
  'เป็น': 'bpen', 'คือ': 'khuue', 'อยู่': 'yùu', 'คะ': 'khá', 'ค่ะ': 'khâ', 'อยาก': 'yàak', 'ต้อง': 'dtâawng',
  'ต้องการ': 'dtâawng-gaan', 'ก็': 'gâw', 'เลย': 'ləəi', 'แล้ว': 'láaeo', 'ดู': 'duu', 'เห็น': 'hěn', 'ฟัง': 'fang',
  'ได้ยิน': 'dâai-yin', 'พูด': 'phûut', 'บอก': 'bàawk', 'กับ': 'gàp', 'และ': 'láe',
  // People and pronouns.
  'ฉัน': 'chǎn', 'ผม': 'phǒm', 'เขา': 'khǎo', 'เรา': 'rao', 'คุณ': 'khun', 'เธอ': 'thəə', 'ใคร': 'khrai',
  'แม่': 'mâae', 'เด็ก': 'dèk', 'ครู': 'khruu', 'หมอ': 'mǎaw', 'เพื่อน': 'phûean', 'แฟน': 'faaen',
  'ผู้หญิง': 'phûu-yǐng', 'คน': 'khon', 'ลูกค้า': 'lûuk-kháa', 'พนักงาน': 'phá-nák-ngaan',
  'ผู้จัดการ': 'phûu-jàt-gaan', 'มาลี': 'maa-lii', 'สมชาย': 'sǒm-chaai', 'บริษัท': 'baaw-rí-sàt',
  // Verbs.
  'จะ': 'jà', 'รอ': 'raaw', 'มา': 'maa', 'ไป': 'bpai', 'วิ่ง': 'wîng', 'คุย': 'khui', 'หยุด': 'yùt', 'กิน': 'gin',
  'เรียน': 'rian', 'ได้': 'dâai', 'ทำงาน': 'tham-ngaan', 'ร้องไห้': 'ráawng-hâi', 'หลับ': 'làp', 'เปิด': 'bpə̀ət',
  'ถึง': 'thǔeng', 'กลับ': 'glàp', 'หัวเราะ': 'hǔa-ráw', 'ไหล': 'lǎi', 'ทำ': 'tham', 'ขอ': 'khǎaw', 'ตก': 'dtòk',
  'ใส่': 'sài', 'สั่น': 'sàn', 'มี': 'mii', 'กำลัง': 'gam-lang', 'ชอบ': 'châawp', 'เข้าใจ': 'khâo-jai',
  'ตื่น': 'dtùen', 'ขับ': 'khàp', 'ว่ายน้ำ': 'wâai-náam', 'ลืม': 'luuem', 'เอา': 'ao', 'เสร็จ': 'sèt',
  'มอง': 'maawng', 'ลอง': 'laawng', 'เห่า': 'hào', 'ย้าย': 'yáai', 'ช่วย': 'chûai', 'สอบ': 'sàawp',
  'ผ่าน': 'phàan', 'ออกไป': 'àawk-bpai', 'หา': 'hǎa', 'เคย': 'khəəi', 'ห้าม': 'hâam', 'อย่า': 'yàa',
  // Things and places.
  'ฝน': 'fǒn', 'น้ำตา': 'náam-dtaa', 'ร้าน': 'ráan', 'คำตอบ': 'kham-dtàawp', 'ผ้าห่ม': 'phâa-hòm', 'น้ำ': 'náam',
  'แก้ว': 'gâaeo', 'เบียร์': 'bia', 'หิมะ': 'hì-má', 'เสื้อ': 'sûea', 'ลม': 'lom', 'ตัว': 'dtua', 'ห้อง': 'hâawng',
  'แอร์': 'aae', 'อาหาร': 'aa-hǎan', 'กาแฟ': 'gaa-faae', 'ห้องน้ำ': 'hâawng-náam', 'บ้าน': 'bâan',
  'หวัด': 'wàt', 'เมืองหลวง': 'mueang-lǔang', 'ไทย': 'thai', 'กรุงเทพฯ': 'grung-thêep', 'ข้าว': 'khâao',
  'ปัญหา': 'bpan-hǎa', 'เงิน': 'ngən', 'ธนาคาร': 'thá-naa-khaan', 'โรงพยาบาล': 'roong-phá-yaa-baan',
  'ชื่อ': 'chûue', 'ราคา': 'raa-khaa', 'ประชุม': 'bprà-chum', 'มันไก่': 'man-gài', 'เตียง': 'dtiang',
  'รถ': 'rót', 'เข็มขัดนิรภัย': 'khěm-khàt-ní-rá-phai', 'โรงเรียน': 'roong-rian', 'ยา': 'yaa',
  'ความช่วยเหลือ': 'khwaam-chûai-lǔea', 'กระเป๋าตังค์': 'grà-bpǎo-dtang', 'หนัง': 'nǎng', 'กุญแจ': 'gun-jaae',
  'ทีวี': 'thii-wii', 'เมนู': 'mee-nuu', 'ตลาด': 'dtà-làat', 'หน้าต่าง': 'nâa-dtàang', 'ภูเขา': 'phuu-khǎo',
  'ฟุตบอล': 'fút-baawn', 'เพลง': 'phleeng', 'เสียง': 'sǐang', 'หมา': 'mǎa', 'วิทยุ': 'wít-thá-yú', 'ข่าว': 'khàao',
  'โทรศัพท์': 'thoo-rá-sàp', 'ภาษาไทย': 'phaa-sǎa-thai', 'ภาษาอังกฤษ': 'phaa-sǎa-ang-grìt', 'ทาง': 'thaang',
  'สถานี': 'sà-thǎa-nii', 'ญี่ปุ่น': 'yîi-bpùn', 'เชียงใหม่': 'chiang-mài', 'วันเกิด': 'wan-gə̀ət',
  // Describing words.
  'เหนื่อย': 'nùeai', 'ดึก': 'dùek', 'อิ่ม': 'ìm', 'มาก': 'mâak', 'สบาย': 'sà-baai', 'ดี': 'dii', 'หนา': 'nǎa',
  'หิว': 'hǐu', 'ร้อน': 'ráawn', 'ใหม่': 'mài', 'สนุก': 'sà-nùk', 'อร่อย': 'à-ràwi', 'เผ็ด': 'phèt', 'มืด': 'mûuet',
  'ดัง': 'dang', 'ช้า': 'cháa', 'เร็ว': 'reo', 'เก่ง': 'gèng', 'หนัก': 'nàk', 'สะอาด': 'sà-àat', 'เงียบ': 'ngîap',
  'แพง': 'phaaeng', 'ฉลาด': 'chà-làat', 'ใจดี': 'jai-dii', 'อเมริกัน': 'à-mee-rí-gan', 'ยินดี': 'yin-dii',
  // Little words.
  'ไม่': 'mâi', 'กัน': 'gan', 'ว่า': 'wâa', 'ที่ไหน': 'thîi-nǎi', 'นั้น': 'nán', 'ไหม': 'mǎi', 'นี้': 'níi',
  'นี่': 'nîi', 'ที่นี่': 'thîi-nîi', 'อะไร': 'à-rai', 'ที่': 'thîi', 'ครับ': 'khráp', 'กี่': 'gìi', 'โมง': 'moong',
  'สิบ': 'sìp', 'ปี': 'bpii', 'บ้าง': 'bâang', 'จัง': 'jang', 'หน่อย': 'nàwi', 'หนึ่ง': 'nùeng', 'หน้า': 'nâa',
  'นะ': 'ná', 'เดี๋ยว': 'dǐao', 'ข้างบน': 'khâang-bon', 'ของ': 'khǎawng', 'ตรงข้าม': 'dtrong-khâam',
  'เท่าไหร่': 'thâo-rài', 'เป็นไร': 'bpen-rai', 'ด้วย': 'dûai', 'พรุ่งนี้': 'phrûng-níi', 'เช้า': 'cháo',
  'เพราะ': 'phráw', 'สอง': 'sǎawng', 'สาม': 'sǎam', 'ทุก': 'thúk', 'หลัง': 'lǎng', 'ถ้า': 'thâa',
  'เหมือนกัน': 'mǔean-gan', 'เมื่อวาน': 'mûea-waan', 'เมื่อคืน': 'mûea-khuen', 'คืน': 'khuen', 'สิ': 'sì',
  'จาก': 'jàak', 'ทั้ง': 'tháng', 'ตอน': 'dtaawn', 'แต่': 'dtàae', 'ทำไม': 'tham-mai', 'ทัน': 'than',
  'หรือยัง': 'rǔue-yang', 'หมด': 'mòt', 'ขอบคุณ': 'khàawp-khun',
};

/** A sentence from its words (spaces between them), the index of the word that fits, and its English. */
function s(words: readonly ContrastWord[], text: string, answer: number, english: string): ContrastSentence {
  const tokens = text.split(' ').filter(Boolean);
  const roman: string[] = [];
  for (const t of tokens) {
    if (t === '/') continue;
    if (t === 'ๆ') { roman.push(roman[roman.length - 1] ?? '?'); continue; }
    roman.push(t === '_' ? (words[answer]?.roman ?? '?') : (ROMAN[t] ?? '?'));
  }
  return { tokens, answer, english, roman: roman.join(' ') };
}

/** A set: its words, then its sentences as [text, answer, English]. */
function set(id: string, words: ContrastWord[], sentences: [string, number, string][]): ContrastSet {
  const romanized = words.map((w) => ({ ...w, roman: ROMAN[w.word] }));
  return { id, words: romanized, sentences: sentences.map(([text, answer, english]) => s(romanized, text, answer, english)) };
}

/** Every token the sentences use that ROMAN lacks: a test keeps this empty. */
export function unromanized(sets: readonly ContrastSet[]): string[] {
  const out = new Set<string>();
  for (const x of sets) for (const sen of x.sentences) for (const t of sen.tokens) if (t !== '_' && t !== '/' && t !== 'ๆ' && !ROMAN[t]) out.add(t);
  for (const x of sets) for (const w of x.words) if (!ROMAN[w.word]) out.add(w.word);
  return [...out];
}

export const THAI_CONTRASTS: readonly ContrastSet[] = [
  set('th-jon', [
    { word: 'จน', rule: 'Until, or so much that, for something that did happen. Before a time word, จน or จนถึง.' },
    { word: 'จนกว่า', rule: "Until something that hasn't happened yet, usually with จะ after it." },
  ], [
    ['ฉัน จะ รอ _ เขา จะ มา', 1, "I'll wait until he comes."],
    ['เขา วิ่ง _ เหนื่อย', 0, 'He ran until he was worn out.'],
    ['เรา คุย กัน _ ดึก', 0, 'We talked until late at night.'],
    ['อย่า ไป _ ฝน จะ หยุด', 1, "Don't go until the rain stops."],
    ['เขา กิน _ อิ่ม มาก', 0, 'He ate until he was really full.'],
    ['ฉัน จะ เรียน _ จะ พูด ได้', 1, "I'll keep studying until I can speak it."],
    ['เด็ก ร้องไห้ _ หลับ ไป', 0, 'The child cried until she fell asleep.'],
    ['ห้าม เปิด _ จะ ถึง วันเกิด', 1, "Don't open it until your birthday."],
    ['ผม จะ อยู่ ที่นี่ _ คุณ จะ กลับ มา', 1, "I'll stay here until you come back."],
    ['เขา หัวเราะ _ น้ำตา ไหล', 0, 'She laughed until she cried.'],
  ]),
  set('th-ruu', [
    { word: 'รู้', rule: 'To know a fact or a piece of information. Often รู้ว่า, "know that".' },
    { word: 'รู้จัก', rule: 'To know a person or a place: to have met them, or be familiar with it.' },
  ], [
    ['ฉัน _ ว่า เขา อยู่ ที่ไหน', 0, 'I know where he lives.'],
    ['คุณ _ ผู้หญิง คน นั้น ไหม', 1, 'Do you know that woman?'],
    ['ผม ไม่ _ ร้าน นี้', 1, "I don't know this shop."],
    ['เขา ไม่ _ ว่า จะ ทำ อะไร', 0, "He doesn't know what to do."],
    ['ยินดี ที่ ได้ _ ครับ', 1, 'Nice to meet you.'],
    ['คุณ _ ไหม ว่า กี่ โมง แล้ว', 0, 'Do you know what time it is?'],
    ['ฉัน _ เขา มา สิบ ปี แล้ว', 1, "I've known him for ten years."],
    ['ใคร _ คำตอบ บ้าง', 0, 'Who knows the answer?'],
    ['คุณ _ เชียงใหม่ ไหม', 1, 'Do you know Chiang Mai?'],
    ['ฉัน _ ว่า คุณ เหนื่อย', 0, "I know you're tired."],
  ]),
  set('th-cold', [
    { word: 'หนาว', rule: 'Cold weather, or a person feeling cold. หน้าหนาว is winter.' },
    { word: 'เย็น', rule: 'Cool or cold things: water, drinks, food, a breeze, the air conditioning.' },
  ], [
    ['ฉัน _ จัง / ขอ ผ้าห่ม หน่อย', 0, "I'm so cold. Could I have a blanket?"],
    ['ขอ น้ำ _ แก้ว หนึ่ง', 1, 'A glass of cold water, please.'],
    ['เบียร์ ไม่ _ เลย', 1, "The beer isn't cold at all."],
    ['หน้า _ ที่ ญี่ปุ่น หิมะ ตก', 0, 'In winter it snows in Japan.'],
    ['กาแฟ _ แล้ว', 1, 'The coffee has gone cold.'],
    ['ใส่ เสื้อ หนา ๆ นะ / เดี๋ยว _', 0, "Wear something warm or you'll get cold."],
    ['ลม _ สบาย ดี', 1, 'The cool breeze feels nice.'],
    ['เขา _ จน ตัว สั่น', 0, "He's so cold he's shivering."],
    ['ห้อง นี้ แอร์ _ มาก', 1, 'The air conditioning in this room is really cold.'],
    ['อาหาร _ หมด แล้ว', 1, 'The food has gone completely cold.'],
  ]),
  set('th-be', [
    { word: 'เป็น', rule: 'Is a kind of person or thing: a job, a nationality, a role. Also for having an illness.' },
    { word: 'คือ', rule: 'Is exactly: names or defines something ("this is", "the problem is").' },
    { word: 'อยู่', rule: 'Is somewhere: a location. After a verb, is in the middle of doing it.' },
  ], [
    ['เขา _ ครู', 0, "She's a teacher."],
    ['ห้องน้ำ _ ข้างบน', 2, 'The bathroom is upstairs.'],
    ['นี่ _ บ้าน ของ ฉัน', 1, 'This is my house.'],
    ['แม่ _ ที่ บ้าน', 2, 'Mom is at home.'],
    ['ผม _ คน อเมริกัน', 0, "I'm American."],
    ['เขา _ หวัด', 0, 'He has a cold.'],
    ['เมืองหลวง ของ ไทย _ กรุงเทพฯ', 1, 'The capital of Thailand is Bangkok.'],
    ['เขา กำลัง กิน ข้าว _', 2, "He's eating right now."],
    ['ปัญหา _ เรา ไม่ มี เงิน', 1, "The problem is we don't have any money."],
    ['ร้าน กาแฟ _ ตรงข้าม ธนาคาร', 2, 'The café is across from the bank.'],
    ['เขา _ หมอ ที่ โรงพยาบาล นี้', 0, "He's a doctor at this hospital."],
  ]),
  set('th-kha', [
    { word: 'คะ', rule: "High tone. Ends a woman's question, or follows a name when calling someone." },
    { word: 'ค่ะ', rule: "Falling tone. Ends a woman's statement, or on its own means yes." },
  ], [
    ['คุณ ชื่อ อะไร _', 0, "What's your name?"],
    ['ฉัน ชื่อ มาลี _', 1, 'My name is Mali.'],
    ['ห้องน้ำ อยู่ ที่ไหน _', 0, "Where's the bathroom?"],
    ['ขอบคุณ _', 1, 'Thank you.'],
    ['ราคา เท่าไหร่ _', 0, 'How much is it?'],
    ['ไม่ เป็นไร _', 1, "It's fine."],
    ['_ / ฉัน เข้าใจ แล้ว', 1, 'Yes, I understand.'],
    ['ไป ด้วย กัน ไหม _', 0, 'Shall we go together?'],
    ['คุณ สมชาย _ / มี คน มา หา', 0, "Somchai, someone's here to see you."],
    ['ฉัน ไม่ ชอบ เผ็ด _', 1, "I don't like spicy food."],
  ]),
  set('th-want', [
    { word: 'อยาก', rule: 'Want to do something. A verb comes after it.' },
    { word: 'ต้อง', rule: 'Must, have to. A verb comes after it.' },
    { word: 'ต้องการ', rule: 'Want or need a thing. A noun usually comes after it. A little formal.' },
  ], [
    ['พรุ่งนี้ ฉัน _ ตื่น เช้า / เพราะ มี ประชุม', 1, 'I have to get up early tomorrow because I have a meeting.'],
    ['หิว จัง / _ กิน ข้าว มันไก่', 0, "I'm so hungry. I want to eat chicken rice."],
    ['ลูกค้า _ ห้อง สอง เตียง', 2, 'The customer wants a room with two beds.'],
    ['ขับ รถ _ ใส่ เข็มขัดนิรภัย', 1, 'You have to wear a seatbelt when you drive.'],
    ['คุณ _ อะไร คะ', 2, 'What would you like?'],
    ['ฉัน ไม่ _ กลับ บ้าน เลย / สนุก มาก', 0, "I don't want to go home at all. It's so fun."],
    ['เด็ก ทุก คน _ ไป โรงเรียน', 1, 'Every child has to go to school.'],
    ['บริษัท _ พนักงาน ใหม่ สาม คน', 2, 'The company needs three new employees.'],
    ['ร้อน จัง / _ ไป ว่ายน้ำ', 0, "It's so hot. I want to go swimming."],
    ['ยา นี้ _ กิน หลัง อาหาร', 1, 'This medicine has to be taken after meals.'],
    ['ผม _ ความช่วยเหลือ', 2, 'I need help.'],
  ]),
  set('th-gaw', [
    { word: 'ก็', rule: 'Then, also: the second half of "if... then", or "too" and "either" with เหมือนกัน.' },
    { word: 'เลย', rule: 'So, as a result. After a describing word, really. With ไม่, not at all.' },
    { word: 'แล้ว', rule: 'Already: the action is done. Comes at the end, after the verb.' },
  ], [
    ['ถ้า คุณ ไป / ฉัน _ ไป ด้วย', 0, "If you go, I'll go too."],
    ['ฝน ตก / ฉัน _ ไม่ ได้ ไป', 1, "It rained, so I didn't go."],
    ['ฉัน กิน ข้าว _', 2, "I've already eaten."],
    ['อร่อย มาก _', 1, "It's really delicious!"],
    ['ไม่ เผ็ด _', 1, 'Not spicy at all.'],
    ['เขา มา ถึง _', 2, "He's arrived."],
    ['ไม่ เป็นไร / ฉัน _ ไม่ รู้ เหมือนกัน', 0, "It's fine. I don't know either."],
    ['เสร็จ _', 2, 'Done!'],
    ['ถ้า ไม่ ชอบ / _ ไม่ ต้อง กิน', 0, "If you don't like it, you don't have to eat it."],
    ['ผม ลืม กระเป๋าตังค์ / _ ต้อง กลับ ไป เอา', 1, 'I forgot my wallet, so I have to go back for it.'],
  ]),
  set('th-see', [
    { word: 'ดู', rule: 'To watch or look at, on purpose.' },
    { word: 'เห็น', rule: "To see: it comes into view, whether you meant to look or not." },
  ], [
    ['เมื่อคืน ฉัน _ หนัง', 0, 'I watched a movie last night.'],
    ['คุณ _ กุญแจ ของ ฉัน ไหม', 1, 'Have you seen my keys?'],
    ['เขา _ ทีวี ทุก คืน', 0, 'He watches TV every night.'],
    ['มืด มาก / มอง ไม่ _ อะไร เลย', 1, "It's so dark I can't see anything."],
    ['ขอ _ เมนู หน่อย', 0, 'Could I see the menu?'],
    ['ฉัน _ เขา ที่ ตลาด เมื่อวาน', 1, 'I saw him at the market yesterday.'],
    ['ลอง _ นี่ สิ', 0, 'Take a look at this.'],
    ['จาก หน้าต่าง / _ ภูเขา ได้', 1, 'You can see the mountains from the window.'],
    ['ไป _ ฟุตบอล กัน', 0, "Let's go watch football."],
    ['ฉัน ไม่ เคย _ หิมะ', 1, "I've never seen snow."],
  ]),
  set('th-hear', [
    { word: 'ฟัง', rule: 'To listen, on purpose.' },
    { word: 'ได้ยิน', rule: 'To hear: a sound reaches you, whether you meant to listen or not.' },
  ], [
    ['ฉัน ชอบ _ เพลง ไทย', 0, 'I like listening to Thai music.'],
    ['คุณ _ เสียง นั้น ไหม', 1, 'Did you hear that sound?'],
    ['พูด ดัง ๆ หน่อย / ฉัน ไม่ _', 1, "Speak up a little. I can't hear."],
    ['_ ครู พูด นะ', 0, 'Listen to the teacher, okay?'],
    ['เมื่อคืน _ หมา เห่า ทั้ง คืน', 1, 'Last night I heard a dog barking all night.'],
    ['เขา ไม่ เคย _ ที่ ฉัน พูด', 0, 'He never listens to what I say.'],
    ['ตอน ขับ รถ / ฉัน ชอบ _ วิทยุ', 0, 'I like listening to the radio when I drive.'],
    ['_ ข่าว ว่า เขา จะ ย้าย บ้าน', 1, "I heard he's moving."],
    ['ลอง _ ดี ๆ', 0, 'Listen carefully.'],
    ['โทรศัพท์ ดัง / แต่ ฉัน ไม่ _', 1, "The phone rang, but I didn't hear it."],
  ]),
  set('th-tell', [
    { word: 'พูด', rule: 'To speak or talk. A language comes after it, or กับ and the person.' },
    { word: 'บอก', rule: 'To tell someone something. The person comes right after it.' },
  ], [
    ['เขา _ ภาษาไทย เก่ง', 0, 'He speaks Thai well.'],
    ['_ แม่ ด้วย นะ / ว่า จะ กลับ ดึก', 1, "Tell Mom I'll be home late."],
    ['ช่วย _ ช้า ๆ หน่อย', 0, 'Please speak slowly.'],
    ['ใคร _ คุณ', 1, 'Who told you?'],
    ['ฉัน อยาก _ กับ ผู้จัดการ', 0, 'I want to talk to the manager.'],
    ['ทำไม ไม่ _ ฉัน', 1, "Why didn't you tell me?"],
    ['_ ทาง ไป สถานี ได้ ไหม', 1, 'Can you tell me the way to the station?'],
    ['เขา _ เร็ว มาก / ฟัง ไม่ ทัน', 0, "He talks so fast I can't keep up."],
    ['อย่า _ ใคร นะ', 1, "Don't tell anyone."],
    ['ที่ บ้าน เรา _ ภาษาอังกฤษ', 0, 'At home we speak English.'],
  ]),
  set('th-and', [
    { word: 'กับ', rule: 'With: together with a person or a thing. Also "and" between two nouns.' },
    { word: 'และ', rule: 'And between two describing words or two clauses. A little formal.' },
  ], [
    ['ฉัน ไป ตลาด _ แม่', 0, 'I went to the market with Mom.'],
    ['เขา เรียน หนัก _ สอบ ผ่าน', 1, 'He studied hard and passed the exam.'],
    ['ฉัน ชอบ กิน ข้าว _ เพื่อน', 0, 'I like eating with friends.'],
    ['ห้อง นี้ สะอาด _ เงียบ', 1, 'This room is clean and quiet.'],
    ['คุณ คุย _ เขา หรือยัง', 0, 'Have you talked with him yet?'],
    ['ฉัน อยู่ _ แฟน', 0, 'I live with my partner.'],
    ['ร้าน นี้ อาหาร อร่อย _ ราคา ไม่ แพง', 1, 'The food here is good and not expensive.'],
    ['ผม เห็น ด้วย _ คุณ', 0, 'I agree with you.'],
    ['เธอ ฉลาด _ ใจดี', 1, "She's smart and kind."],
    ['เขา ตื่น เช้า _ ออกไป วิ่ง', 1, 'He got up early and went for a run.'],
  ]),
];
