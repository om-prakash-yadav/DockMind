import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Backend address. The built-in default comes from mobile/.env (EXPO_PUBLIC_API_URL) and is fixed when the app is
 * built or bundled. The clerk can change it in the app (the gear on the home screen), which is saved on the phone,
 * so one installed build works on any network. On a real phone this must be the server's LAN IP, never localhost.
 */
const KEY = 'dockmind.apiUrl.v1';

export const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:8080').replace(/\/$/, '');

let current = DEFAULT_API_URL;

export const apiUrl = () => current;

/** Resolves once a saved address, if any, has been loaded. Requests wait for it so they never use a stale default. */
export const settingsReady: Promise<void> = (async () => {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) current = saved;
  } catch {}
})();

/** Turns what the clerk typed into a clean base URL, or null if it cannot be one. "192.168.1.5:8080" gets http://. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/+$/, '');
  return /^https?:\/\/[^\s/:]+(:\d{1,5})?$/i.test(s) ? s : null;
}

export async function setApiUrl(url: string) {
  current = url;
  try {
    await AsyncStorage.setItem(KEY, url);
  } catch {}
}
