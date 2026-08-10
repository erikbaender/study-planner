import { useState } from "react";

/**
 * Resets local state when a key changes during render, so the next entry is
 * never painted with the previous entry's values for a frame. This must stay
 * out of an effect: effects run after that paint and would reintroduce it.
 */
export function useResetWhen<T>(key: T, reset: () => void) {
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    reset();
  }
}
