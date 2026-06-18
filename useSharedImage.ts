/**
 * useSharedImage.ts
 * ---------------------------------------------------------------------------
 * Receives an image shared into the app from the iOS Share Sheet.
 *
 * The iOS Share Extension writes the picked file into a shared App Group, and
 * the host app reads it back when it returns to the foreground (or is opened
 * via its custom URL scheme). This hook wires up that handoff: it watches
 * AppState + Linking, reads the App Group payload, fires a callback with the
 * image, and then clears the shared slot so the same image isn't processed
 * twice.
 *
 * Robustness notes:
 *   - The callback is read through a ref, so the mount-only effect always calls
 *     the latest handler instead of a stale closure from the first render.
 *   - A re-entrancy lock + slot clearing makes overlapping triggers (AppState
 *     `active` and a Linking `url` firing together) idempotent: only the first
 *     read sees the payload, the rest get an already-cleared slot.
 *
 * Depends on: react-native-shared-group-preferences.
 * Configure APP_GROUP / URL_SCHEME below to match your native setup.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import SharedGroupPreferences from 'react-native-shared-group-preferences';

const APP_GROUP = 'group.com.example.app';
const URL_SCHEME = 'myapp://';
const SHARED_KEY = 'ShareKey';

export interface SharedImage {
  uri: string;
}

interface Options {
  /** Called once per shared image, after it is read from the App Group. */
  onImageReceived: (image: SharedImage) => void;
}

export const useSharedImage = ({ onImageReceived }: Options) => {
  // Keep the latest callback in a ref so the mount-only effect below never
  // invokes a stale handler when the parent passes a new `onImageReceived`.
  const callbackRef = useRef(onImageReceived);
  callbackRef.current = onImageReceived;

  // Prevents two near-simultaneous triggers from reading the same payload
  // before the slot is cleared.
  const readingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const readSharedImage = async () => {
      if (Platform.OS !== 'ios') return;
      if (readingRef.current) return;
      readingRef.current = true;

      try {
        const raw = await SharedGroupPreferences.getItem(SHARED_KEY, APP_GROUP);
        if (!raw) return;

        const parsed = JSON.parse(raw) as Array<{ path: string }>;
        const path = parsed?.[0]?.path;
        if (!path) return;

        if (mounted) callbackRef.current({ uri: path });
      } catch (error) {
        console.error('Failed to read shared image:', error);
      } finally {
        // Always clear the slot — both on success and on parse failure — so a
        // stale payload can never be replayed on the next foreground.
        await SharedGroupPreferences.setItem(SHARED_KEY, null, APP_GROUP).catch(
          () => {},
        );
        readingRef.current = false;
      }
    };

    // 1) When the app becomes active (returning from the Share Sheet).
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') readSharedImage();
    });

    // 2) When opened via the custom URL scheme.
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (url.includes(URL_SCHEME)) readSharedImage();
    });

    // 3) Cold start: check the launch URL, then the App Group once. The lock +
    //    slot clearing make a redundant read here harmless (it just no-ops).
    Linking.getInitialURL().then((url) => {
      if (url?.includes(URL_SCHEME)) readSharedImage();
    });
    readSharedImage();

    return () => {
      mounted = false;
      appStateSub.remove();
      urlSub.remove();
    };
  }, []);
};

/* ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 * useSharedImage({
 *   onImageReceived: (image) => {
 *     navigation.navigate('Editor', { photo: image });
 *   },
 * });
 * ------------------------------------------------------------------------- */
