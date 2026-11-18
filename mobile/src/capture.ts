import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';

export interface Photo {
  uri: string;
  filename: string;
  /** Generated once per photo. Every retry of this photo's upload must reuse it. */
  idempotencyKey: string;
}

/** Longest side after downscaling. Phone photos are 4000px+; the model reads a note fine at 1600. */
const MAX_SIDE = 1600;

/** Opens the camera or the gallery. Returns null if the clerk backs out or denies permission. */
export async function pickPhoto(source: 'camera' | 'gallery'): Promise<Photo | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is needed to photograph the note.');
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const resize = asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE };
  const small = Math.max(asset.width, asset.height) > MAX_SIDE;
  const out = await ImageManipulator.manipulateAsync(asset.uri, small ? [{ resize }] : [], {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return {
    uri: out.uri,
    // Keep the original name: the fixture extractor reads note-N from it.
    filename: asset.fileName ?? 'note.jpg',
    idempotencyKey: Crypto.randomUUID(),
  };
}
