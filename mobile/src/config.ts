/** Backend address. On a real phone this must be the PC's LAN IP, not localhost. Set it in mobile/.env. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://172.19.5.8:8080').replace(/\/$/, '');
