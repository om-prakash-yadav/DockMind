import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { drain } from './queue';

const POLL_MS = 15000;

/**
 * Keeps the queue draining without the clerk doing anything: on start, whenever the connection comes back, when the
 * app returns to the foreground, and every 15 seconds as a safety net (a phone can report "connected" while the
 * dock's signal is still useless, so the connection event alone is not enough).
 */
export function useAutoSync() {
  useEffect(() => {
    const run = () => void drain().catch(() => {});
    run();
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected) run();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, POLL_MS);
    return () => {
      net();
      app.remove();
      clearInterval(timer);
    };
  }, []);
}
