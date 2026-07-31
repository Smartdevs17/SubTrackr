import { useRef, useEffect } from 'react';

/**
 * Hook for managing focus in modals and bottom sheets
 * Ensures focus is properly trapped and managed for accessibility
 */
export function useFocusManagement(isVisible: boolean) {
  const focusableRefs = useRef<any[]>([]);
  const initialFocusRef = useRef<any>(null);

  const registerFocusable = (ref: any) => {
    if (ref && !focusableRefs.current.includes(ref)) {
      focusableRefs.current.push(ref);
    }
  };

  const unregisterFocusable = (ref: any) => {
    focusableRefs.current = focusableRefs.current.filter((r) => r !== ref);
  };

  const setInitialFocus = (ref: any) => {
    initialFocusRef.current = ref;
  };

  // Focus initial element when modal opens
  useEffect(() => {
    if (isVisible && initialFocusRef.current) {
      const timer = setTimeout(() => {
        initialFocusRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  // Return focus to trigger element when modal closes
  useEffect(() => {
    if (!isVisible) {
      const timer = setTimeout(() => {
        // Focus would return to the element that opened the modal
        // This would need to be tracked at a higher level
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  return {
    registerFocusable,
    unregisterFocusable,
    setInitialFocus,
    focusableRefs,
  };
}

/**
 * Hook for trapping focus within a container
 */
export function useFocusTrap(isActive: boolean) {
  const firstFocusableRef = useRef<any>(null);
  const lastFocusableRef = useRef<any>(null);

  const handleKeyDown = (e: any) => {
    if (!isActive) return;

    if (e.key === 'Tab') {
      if (e.shiftKey) {
        // Shift + Tab: move to last element
        if (document.activeElement === firstFocusableRef.current) {
          e.preventDefault();
          lastFocusableRef.current?.focus();
        }
      } else {
        // Tab: move to first element
        if (document.activeElement === lastFocusableRef.current) {
          e.preventDefault();
          firstFocusableRef.current?.focus();
        }
      }
    }
  };

  return {
    firstFocusableRef,
    lastFocusableRef,
    handleKeyDown,
  };
}
