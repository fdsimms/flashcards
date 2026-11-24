import { requireOptionalNativeModule } from 'expo';

const mod = requireOptionalNativeModule<{ isBluetoothOutput(): boolean }>('AudioRoute');

/**
 * Whether sound is going to Bluetooth headphones or a Bluetooth speaker now; null when that can't
 * be told (a build made before this module was added).
 */
export function isBluetoothOutput(): boolean | null {
  try {
    return mod ? mod.isBluetoothOutput() : null;
  } catch {
    return null;
  }
}
