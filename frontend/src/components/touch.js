import { useEffect, useRef } from 'react';

// Touch-only device: no hover and a coarse pointer. Copy that says "press F3"
// is wrong on such a screen, so the pages ask this before choosing words.
export const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// A list above its detail (the way Vendors, Customers and Requisitions stack
// on narrow screens): tapping a row must move the page to the detail, or the
// tap looks dead. `query` is the breakpoint below which the grid stacks.
export function useRevealOnSelect(selectedId, query = '(max-width: 1279px)') {
  const ref = useRef(null);

  useEffect(() => {
    if (!selectedId || !window.matchMedia(query).matches) return undefined;
    const timer = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedId, query]);

  return ref;
}
