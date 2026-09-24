import { useEffect, useState } from 'react';

// useState that survives page navigation within the same browser tab, so a
// half-written program is not lost when the user visits another page.
export function useSessionState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private mode) - the app still works.
    }
  }, [key, value]);

  return [value, setValue];
}
