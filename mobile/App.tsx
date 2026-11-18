import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ReceiptScreen from './src/screens/ReceiptScreen';

/** Two screens, so a plain state switch is enough: the list, or one receipt. */
export default function App() {
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // Bumped on return to the list so it reloads and shows the receipt's new status.
  const [listKey, setListKey] = useState(0);

  const back = () => {
    setReceiptId(null);
    setListKey((k) => k + 1);
  };

  // Android back button returns to the list instead of closing the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (receiptId) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [receiptId]);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      {receiptId ? (
        <ReceiptScreen id={receiptId} onBack={back} />
      ) : (
        <HomeScreen key={listKey} onOpenReceipt={setReceiptId} />
      )}
    </View>
  );
}
