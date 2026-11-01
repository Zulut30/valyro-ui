'use client';

import { useState, type RefObject } from 'react';
import { useLayoutEffect } from '../primitives/react-compat';

/*
 * Small helpers shared by the interactive blocks. Pure functions here are unit-tested in interactive.test.ts.
 */

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Ids in their first-seen order, each once. */
export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Ids that occur more than once, each reported once. */
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

const warned = new Set<string>();
/** A data problem the component works around, reported once per message in the console (browser only). */
export function warnOnce(component: string, message: string) {
  const text = `${component}: ${message}`;
  if (typeof window === 'undefined' || warned.has(text)) return;
  warned.add(text);
  console.warn(text);
}

/**
 * Width and height of the element in `ref`, kept current with a ResizeObserver. Null on the server and before
 * the first measure, so the server markup stays deterministic.
 */
export function useElementSize(ref: RefObject<Element | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) => (prev && prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
