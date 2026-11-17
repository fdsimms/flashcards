import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { CARD_FONTS_DIR } from '../core/cardFonts';
import { fontFileNames, type AppFont } from '../core/fonts';

/**
 * The bundled fonts where a card page can load them. A WebView reads only the documents folder (like
 * the media folder and MathJax), not the app bundle the files ship in, so each font a card uses is
 * copied there the first time a card in it is shown.
 */

// Metro needs each file written out as a literal require.
const FILES: Record<string, number> = {
  'Alegreya_400Regular.ttf': require('../../assets/fonts/Alegreya_400Regular.ttf'),
  'Alegreya_600SemiBold.ttf': require('../../assets/fonts/Alegreya_600SemiBold.ttf'),
  'Alegreya_700Bold.ttf': require('../../assets/fonts/Alegreya_700Bold.ttf'),
  'BadScript_400Regular.ttf': require('../../assets/fonts/BadScript_400Regular.ttf'),
  'Caveat_400Regular.ttf': require('../../assets/fonts/Caveat_400Regular.ttf'),
  'Caveat_600SemiBold.ttf': require('../../assets/fonts/Caveat_600SemiBold.ttf'),
  'Caveat_700Bold.ttf': require('../../assets/fonts/Caveat_700Bold.ttf'),
  'Charmonman_400Regular.ttf': require('../../assets/fonts/Charmonman_400Regular.ttf'),
  'Charmonman_700Bold.ttf': require('../../assets/fonts/Charmonman_700Bold.ttf'),
  'Comfortaa_400Regular.ttf': require('../../assets/fonts/Comfortaa_400Regular.ttf'),
  'Comfortaa_600SemiBold.ttf': require('../../assets/fonts/Comfortaa_600SemiBold.ttf'),
  'Comfortaa_700Bold.ttf': require('../../assets/fonts/Comfortaa_700Bold.ttf'),
  'Inter_400Regular.ttf': require('../../assets/fonts/Inter_400Regular.ttf'),
  'Inter_600SemiBold.ttf': require('../../assets/fonts/Inter_600SemiBold.ttf'),
  'Inter_700Bold.ttf': require('../../assets/fonts/Inter_700Bold.ttf'),
  'Lora_400Regular.ttf': require('../../assets/fonts/Lora_400Regular.ttf'),
  'Lora_600SemiBold.ttf': require('../../assets/fonts/Lora_600SemiBold.ttf'),
  'Lora_700Bold.ttf': require('../../assets/fonts/Lora_700Bold.ttf'),
  'Mali_400Regular.ttf': require('../../assets/fonts/Mali_400Regular.ttf'),
  'Mali_600SemiBold.ttf': require('../../assets/fonts/Mali_600SemiBold.ttf'),
  'Mali_700Bold.ttf': require('../../assets/fonts/Mali_700Bold.ttf'),
  'Manrope_400Regular.ttf': require('../../assets/fonts/Manrope_400Regular.ttf'),
  'Manrope_600SemiBold.ttf': require('../../assets/fonts/Manrope_600SemiBold.ttf'),
  'Manrope_700Bold.ttf': require('../../assets/fonts/Manrope_700Bold.ttf'),
  'MarckScript_400Regular.ttf': require('../../assets/fonts/MarckScript_400Regular.ttf'),
  'Mitr_400Regular.ttf': require('../../assets/fonts/Mitr_400Regular.ttf'),
  'Mitr_600SemiBold.ttf': require('../../assets/fonts/Mitr_600SemiBold.ttf'),
  'Mitr_700Bold.ttf': require('../../assets/fonts/Mitr_700Bold.ttf'),
  'Nunito_400Regular.ttf': require('../../assets/fonts/Nunito_400Regular.ttf'),
  'Nunito_600SemiBold.ttf': require('../../assets/fonts/Nunito_600SemiBold.ttf'),
  'Nunito_700Bold.ttf': require('../../assets/fonts/Nunito_700Bold.ttf'),
  'SourceSerif4_400Regular.ttf': require('../../assets/fonts/SourceSerif4_400Regular.ttf'),
  'SourceSerif4_600SemiBold.ttf': require('../../assets/fonts/SourceSerif4_600SemiBold.ttf'),
  'SourceSerif4_700Bold.ttf': require('../../assets/fonts/SourceSerif4_700Bold.ttf'),
  'Sriracha_400Regular.ttf': require('../../assets/fonts/Sriracha_400Regular.ttf'),
  'Yomogi_400Regular.ttf': require('../../assets/fonts/Yomogi_400Regular.ttf'),
  'ZenKurenaido_400Regular.ttf': require('../../assets/fonts/ZenKurenaido_400Regular.ttf'),
  'ZenMaruGothic_400Regular.ttf': require('../../assets/fonts/ZenMaruGothic_400Regular.ttf'),
};

/** The folder's file:// URI with a trailing slash, for `cardDocument`'s `fontBase`. */
export function cardFontsBase(): string {
  const uri = new Directory(Paths.document, CARD_FONTS_DIR).uri;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

const installing = new Map<AppFont, Promise<void>>();

/** Puts a font's files in place if they aren't there yet. Safe to call for every page. */
export function installCardFont(id: AppFont): Promise<void> {
  let p = installing.get(id);
  if (!p) {
    p = copyFont(id).catch((e) => { installing.delete(id); throw e; });
    installing.set(id, p);
  }
  return p;
}

async function copyFont(id: AppFont): Promise<void> {
  const dir = new Directory(Paths.document, CARD_FONTS_DIR);
  dir.create({ idempotent: true, intermediates: true });
  for (const name of fontFileNames(id)) {
    const dest = new File(dir, name);
    if (dest.exists) continue;
    const module = FILES[name];
    if (module === undefined) throw new Error(`The font file ${name} isn't bundled`);
    const [asset] = await Asset.loadAsync(module);
    if (!asset.localUri) throw new Error(`The font file ${name} has no local file`);
    // Copied under another name and then renamed, so a copy cut short never passes for the font.
    const part = new File(dir, `${name}.part`);
    await new File(asset.localUri).copy(part, { overwrite: true });
    await part.move(dest);
  }
  // An earlier version's folder is no longer loaded by any page.
  for (const entry of Paths.document.list()) {
    if (entry instanceof Directory && entry.name.startsWith('card-fonts-') && entry.name !== CARD_FONTS_DIR) entry.delete();
  }
}
