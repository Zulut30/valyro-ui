'use client';

import { useRef, useState, type FocusEvent, type KeyboardEvent, type RefCallback } from 'react';
import { stepIndex } from './useListNavigation';
import { getDirection, inlineArrowStep, type Direction } from './utils';
import { withUserProps, type UserProps } from './prop-getters';

/*
 * Roving tab stop for a row or column of buttons (a toolbar, a toggle group): Tab enters the group once, on
 * one item; arrows, Home and End move focus between the items, skipping disabled ones; Left / Right swap in
 * RTL. Focus moves, nothing is pressed: the caller decides what Space and Enter do (a <button> clicks).
 */

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

/**
 * Index a roving-focus key moves to (arrows, Home, End), or null for other keys. A horizontal row moves on
 * Left / Right (swapped in RTL), a vertical one on Up / Down, `both` on all four. Without `loop` the ends stop.
 */
export function rovingTarget(
  key: string,
  count: number,
  from: number,
  isDisabled: (index: number) => boolean = () => false,
  orientation: RovingOrientation = 'horizontal',
  direction: Direction = 'ltr',
  loop = true,
): number | null {
  if (count <= 0) return null;
  // A vertical list moves on Up/Down only, leaving Left/Right to the page (APG toolbar, Radix).
  const inline = orientation === 'vertical' ? 0 : inlineArrowStep(key, direction);
  const prev = inline === -1 || (orientation !== 'horizontal' && key === 'ArrowUp');
  const next = inline === 1 || (orientation !== 'horizontal' && key === 'ArrowDown');
  if (prev) return stepIndex(count, from, -1, isDisabled, loop);
  if (next) return stepIndex(count, from, 1, isDisabled, loop);
  if (key === 'Home') return stepIndex(count, -1, 1, isDisabled, false);
  if (key === 'End') return stepIndex(count, count, -1, isDisabled, false);
  return null;
}

export interface RovingFocusOptions {
  /** Number of items. */
  count: number;
  /** Which arrows move: Left / Right, Up / Down or all four. Default `horizontal`. */
  orientation?: RovingOrientation;
  /** Past the last item, arrows wrap to the first. Default true. */
  loop?: boolean;
  /** Reading direction; read from the focused item when left out. */
  dir?: Direction;
  isDisabled?: (index: number) => boolean;
  /** The item that holds the tab stop until one is focused (the pressed one); else the first enabled item. */
  preferredIndex?: number;
}

export interface RovingFocus {
  /** The item holding the tab stop (tabIndex 0), -1 when every item is disabled. */
  tabStop: number;
  /** Moves focus to an item. */
  focus: (index: number) => void;
  /** Props of an item: ref, tabIndex, and the keys and focus tracking. Merges yours (see withUserProps). */
  getItemProps: (index: number, props?: UserProps) => {
    ref: RefCallback<HTMLElement>;
    tabIndex: number;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
  };
}

/** One tab stop for a group of items, moved with arrows, Home and End (WAI-ARIA toolbar / toggle group). */
export function useRovingFocus({
  count,
  orientation = 'horizontal',
  loop = true,
  dir,
  isDisabled = () => false,
  preferredIndex,
}: RovingFocusOptions): RovingFocus {
  const [focused, setFocused] = useState<number | null>(null);
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const refs = useRef<RefCallback<HTMLElement>[]>([]);

  const usable = (index: number | null | undefined): index is number =>
    index != null && index >= 0 && index < count && !isDisabled(index);
  const tabStop = usable(focused) ? focused : usable(preferredIndex) ? preferredIndex : stepIndex(count, -1, 1, isDisabled, false);

  const focus = (index: number) => {
    nodes.current[index]?.focus();
  };

  const refFor = (index: number) => {
    let ref = refs.current[index];
    if (!ref) {
      ref = (node) => {
        nodes.current[index] = node;
      };
      refs.current[index] = ref;
    }
    return ref;
  };

  return {
    tabStop,
    focus,
    getItemProps: (index, props) =>
      withUserProps(
        {
          ref: refFor(index),
          tabIndex: index === tabStop ? 0 : -1,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
            const direction = dir ?? getDirection(event.currentTarget);
            const target = rovingTarget(event.key, count, index, isDisabled, orientation, direction, loop);
            if (target == null) return;
            event.preventDefault();
            if (target !== index) focus(target);
          },
          onFocus: () => setFocused(index),
        },
        props,
      ),
  };
}
