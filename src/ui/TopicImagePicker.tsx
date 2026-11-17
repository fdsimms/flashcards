import * as Clipboard from 'expo-clipboard';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { ActionSheetIOS, Alert, Text } from 'react-native';
import { Refusal } from '../core/failure';
import { JPEG_QUALITY, base64Of, fitsServer, resizeTo } from '../reader/topicImage';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

export type PickedImage = { base64: string; mediaType: 'image/jpeg' };

const TOO_BIG = new Refusal("This image is too large to send. Take a closer photo of just the page, or crop the screenshot.");

/** Shrinks a photo or screenshot on the phone to a JPEG the server takes, and returns its base64 text. */
async function shrunk(uri: string, width: number, height: number): Promise<PickedImage> {
  const context = ImageManipulator.manipulate(uri);
  const size = resizeTo(width, height);
  if (size) context.resize(size);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64 || !fitsServer(saved.base64)) throw TOO_BIG;
  return { base64: saved.base64, mediaType: 'image/jpeg' };
}

async function fromPicker(source: 'camera' | 'library'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const allowed = await ImagePicker.requestCameraPermissionsAsync();
    if (!allowed.granted) throw new Refusal("Franki can't use the camera. Turn it on for Franki in the Settings app, or choose a photo from your library.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.9 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets?.[0];
  return asset ? shrunk(asset.uri, asset.width, asset.height) : null;
}

/** A copied image (a screenshot, a picture from a web page), or null when the clipboard holds none. */
async function fromClipboard(): Promise<PickedImage | null> {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: JPEG_QUALITY });
  if (!image) return null;
  const base64 = base64Of(image.data);
  if (!fitsServer(base64)) throw TOO_BIG;
  return { base64, mediaType: 'image/jpeg' };
}

/**
 * New topic's "From an image" button: an action sheet to take a photo, choose one from the library
 * (screenshots are there too) or paste a copied image. It hands back the image shrunk to a JPEG and
 * nothing else; what Claude makes of it is the screen's. A refusal or failure is thrown for the screen to show.
 */
export function TopicImagePicker({ label, onPicked, onFailed, disabled }: {
  label: string;
  onPicked: (image: PickedImage) => void;
  onFailed: (e: unknown) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  const run = async (get: () => Promise<PickedImage | null>, none?: string) => {
    try {
      const image = await get();
      if (image) onPicked(image);
      else if (none) Alert.alert('No image to paste', none);
    } catch (e) {
      onFailed(e);
    }
  };
  const open = async () => {
    haptic.tap();
    const canPaste = await Clipboard.hasImageAsync().catch(() => false);
    const options = ['Take photo', 'Choose from library', ...(canPaste ? ['Paste image'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
      if (options[i] === 'Take photo') run(() => fromPicker('camera'));
      if (options[i] === 'Choose from library') run(() => fromPicker('library'));
      if (options[i] === 'Paste image') run(fromClipboard, "Copy a photo or screenshot first, then paste it here.");
    });
  };
  return (
    <Tappable
      onPress={open}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.98}
      dimTo={0.85}
      restOpacity={disabled ? 0.45 : 1}
      style={{
        minHeight: MIN_TAP, borderRadius: radius.m + 2, ...smooth, paddingHorizontal: space.l, paddingVertical: space.s,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s,
        backgroundColor: c.fill, borderWidth: 1, borderColor: c.controlEdge,
      }}
    >
      <Icon name="photo" color={c.text} />
      <Text style={{ ...type.headline, color: c.text }}>{label}</Text>
    </Tappable>
  );
}
