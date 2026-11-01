'use client';

import { useEffect, useRef, useState } from 'react';
import { emptyHistory, record, redo, undo, type History } from './history';

interface Options<T> {
  /** The value on screen (controlled or not). */
  value: T;
  /** Proposes a value: useControllableState's setter. */
  setValue: (value: T) => void;
  /** Most actions kept. */
  limit: number;
  /** Whether two values are the same composition (an echo of the last proposal is not an outside change). */
  same: (a: T, b: T) => boolean;
}

/** Changes of the same kind and target closer together than this are one action (a slider drag, typed digits). */
const COALESCE_MS = 800;

/**
 * Undo/redo for an editor whose value may be controlled. Each committed change records the previous value; undo and
 * redo propose the snapshot through `setValue`, so a controlled parent still decides. A value that arrives from
 * outside and is not the echo of the last proposal replaces the composition and clears the history.
 */
export function useEditorHistory<T>({ value, setValue, limit, same }: Options<T>) {
  const [history, setHistory] = useState<History<T>>(emptyHistory);
  const proposed = useRef(value);
  const group = useRef<{ key: string; at: number } | null>(null);
  const sameRef = useRef(same);
  sameRef.current = same;

  useEffect(() => {
    if (!sameRef.current(value, proposed.current)) {
      setHistory(emptyHistory());
      group.current = null;
    }
    proposed.current = value;
  }, [value]);

  /** Commits `next` as one action; `key` merges a quick run of changes of one kind (`opacity:p1`). */
  const commit = (next: T, key?: string) => {
    if (same(next, value)) return;
    const now = Date.now();
    const merged = !!key && group.current?.key === key && now - group.current.at < COALESCE_MS;
    group.current = key ? { key, at: now } : null;
    if (!merged) setHistory((h) => record(h, value, limit));
    proposed.current = next;
    setValue(next);
  };

  const step = (direction: 'undo' | 'redo') => {
    const result = (direction === 'undo' ? undo : redo)(history, value);
    if (!result) return;
    group.current = null;
    setHistory(result.history);
    proposed.current = result.value;
    setValue(result.value);
  };

  return {
    commit,
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
