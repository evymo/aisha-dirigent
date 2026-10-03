import { useEffect, useRef } from 'react';

/**
 * Hook to track if a component is mounted.
 * Useful for preventing state updates on unmounted components.
 *
 * @returns A ref object that is true when mounted and false when unmounted.
 */
export function useIsMountedRef() {
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return isMountedRef;
}
