'use client';

import type { MouseEvent, ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, XIcon } from '../icons';
import { cx } from '../primitives';
import './drag-moves.css';

/*
 * The alternative to dragging that every drag-and-drop list in the kit shares (Sortable, KanbanBoard, CrmPipeline,
 * TierList). Keyboard users lift an item with Space and move it with the arrows; that is not enough:
 * - a screen reader in browse mode (NVDA, JAWS) or on a phone (VoiceOver, TalkBack) sends a click, not the keys;
 * - WCAG 2.5.7 asks for a single-pointer way to do what a drag does.
 * So a lifted item shows buttons that move it one step, drop it or cancel, and a list without a visible handle gets a
 * start button that a screen reader finds in the item (hidden until it has focus). Every step is announced.
 */

export type MoveIcon = 'up' | 'down' | 'start' | 'end' | 'drop' | 'cancel';

export interface MoveAction {
  /** Stable name, kept on the button as `data-move` so focus can find it again after the item moved. */
  id: string;
  label: string;
  icon: MoveIcon;
  /** At the end of the list: the button stays focusable (aria-disabled) so focus is not lost on it. */
  disabled?: boolean;
  onPress: () => void;
}

const ICONS: Record<MoveIcon, ReactNode> = {
  up: <ChevronUpIcon size={16} />,
  down: <ChevronDownIcon size={16} />,
  start: <ChevronLeftIcon size={16} />,
  end: <ChevronRightIcon size={16} />,
  drop: <CheckIcon size={16} />,
  cancel: <XIcon size={16} />,
};

/** Keeps a press on the bar from starting the item's own pointer drag or click. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

export interface DragMoveBarProps {
  /** Name of the group, e.g. "Reorder Apples". */
  label: string;
  actions: readonly MoveAction[];
  /** Escape on a button: put the item back, as Escape on the item does. */
  onEscape?: () => void;
  className?: string;
}

/** Buttons on a lifted item: move it a step, drop it, cancel. */
export function DragMoveBar({ label, actions, onEscape, className }: DragMoveBarProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('ui-drag-moves', className)}
      onPointerDown={stop}
      onKeyDown={(event) => {
        // Escape puts the item back and goes no further (a dialog around the list stays open).
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault();
          stop(event);
          onEscape();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="ui-drag-moves__button"
          data-move={action.id}
          data-icon={action.icon}
          aria-label={action.label}
          title={action.label}
          aria-disabled={action.disabled || undefined}
          onClick={(event: MouseEvent) => {
            stop(event);
            if (!action.disabled) action.onPress();
          }}
        >
          {ICONS[action.icon]}
        </button>
      ))}
    </div>
  );
}

/**
 * Lifts the item for screen-reader users, whose virtual cursor cannot press Space on it. Out of the Tab order
 * (keyboard users have Space) and visually hidden until something focuses it.
 */
export function DragStartButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="ui-drag-moves__start"
      onPointerDown={stop}
      onClick={(event) => {
        stop(event);
        onPress();
      }}
    >
      {label}
    </button>
  );
}

/** Focuses the bar button `id` inside `container`, e.g. after a move re-rendered the item somewhere else. */
export function focusMoveButton(container: Element | null | undefined, id: string) {
  const button = container?.querySelector<HTMLElement>(`.ui-drag-moves__button[data-move="${id}"]`);
  if (button && document.activeElement !== button) button.focus({ preventScroll: true });
  return !!button;
}

/** The bar button that has focus inside `container`, if any: the one to focus again after the next move. */
export function focusedMoveButton(container: Element | null | undefined): string | null {
  const active = document.activeElement;
  if (!container || !(active instanceof HTMLElement) || !container.contains(active)) return null;
  return active.closest<HTMLElement>('.ui-drag-moves__button')?.dataset.move ?? null;
}
