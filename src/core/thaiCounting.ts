/**
 * What each common Thai counting word counts, with its romanization. The card's Counting box
 * (`renderCard`) and the Counting tool's rule after a miss (`tools/thai/counting.ts`) both read it,
 * so the two say the same thing. A counting word not listed here is shown without a description.
 */
export interface ThaiCountingWord {
  roman: string;
  /** Completes "<word> counts ...". */
  counts: string;
}

export const THAI_COUNTING_WORDS: Record<string, ThaiCountingWord> = {
  ตัว: { roman: 'dtua', counts: 'animals, and tables, chairs and clothes' },
  คน: { roman: 'khon', counts: 'people' },
  เล่ม: { roman: 'lêm', counts: 'books and knives' },
  คัน: { roman: 'khan', counts: 'vehicles, umbrellas and spoons' },
  ใบ: { roman: 'bai', counts: 'containers, bags and cards' },
  ลูก: { roman: 'lûuk', counts: 'fruit and balls' },
  หลัง: { roman: 'lǎng', counts: 'houses and buildings' },
  ขวด: { roman: 'khùat', counts: 'bottles of something' },
  แก้ว: { roman: 'gâew', counts: 'glasses and cups of a drink' },
  แห่ง: { roman: 'hèng', counts: 'places and institutions, such as hospitals, schools and banks' },
  อัน: { roman: 'an', counts: 'small things in general' },
  ชิ้น: { roman: 'chín', counts: 'pieces, such as food, cloth and work' },
  ที่: { roman: 'thîi', counts: 'places, seats and servings' },
  เรื่อง: { roman: 'rûeang', counts: 'stories, films and matters' },
  ครั้ง: { roman: 'khráng', counts: 'times, as in occasions' },
  ชุด: { roman: 'chút', counts: 'sets and outfits' },
  คู่: { roman: 'khûu', counts: 'pairs' },
  ดอก: { roman: 'dàawk', counts: 'flowers' },
  ต้น: { roman: 'dtôn', counts: 'trees and plants' },
  ห้อง: { roman: 'hâawng', counts: 'rooms' },
  จาน: { roman: 'jaan', counts: 'plates of food' },
  ถ้วย: { roman: 'thûay', counts: 'bowls and small cups' },
  แผ่น: { roman: 'phàen', counts: 'flat things, such as sheets, discs and slices' },
  เม็ด: { roman: 'mét', counts: 'pills, seeds and beads' },
  ฉบับ: { roman: 'chà-bàp', counts: 'letters, documents and newspapers' },
  ข้อ: { roman: 'khâaw', counts: 'points and items on a list, such as questions, rules and goals' },
  อย่าง: { roman: 'yàang', counts: 'kinds and types' },
  องค์: { roman: 'ong', counts: 'monks, royalty and sacred images' },
};
