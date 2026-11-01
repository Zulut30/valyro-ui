'use client';

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type RefCallback } from 'react';
import { useDisclosure } from '../primitives/useDisclosure';
import { useFold } from '../primitives/useFold';
import { cleanupRef, inertAttr, useId, useLayoutEffect } from '../primitives/react-compat';
import { withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Collapsible without its markup: open or closed (controlled or not), the trigger's
 * aria-expanded / aria-controls, and content that unfolds and folds by height (useFold) instead of jumping.
 * Closed content stays findable: with `hidden="until-found"` the browser's find-in-page opens it.
 */

export type CollapsibleHiddenMode = 'until-found' | 'unmount' | 'keep';

export interface CollapsibleOptions {
  open?: boolean;
  /** Initial state when uncontrolled. Default false. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger does nothing. */
  disabled?: boolean;
  /** Height in px shown while closed ("show more"); 0 hides the content. Default 0. */
  collapsedHeight?: number;
  /**
   * What closed content does: `until-found` stays in the DOM, hidden, and find-in-page opens it; `keep` stays
   * hidden in the DOM; `unmount` drops it. Default `until-found`.
   */
  hidden?: CollapsibleHiddenMode;
  /** Unfold on the smooth spring instead of the theme's curve. */
  spring?: boolean;
}

type StateAttrs = { 'data-state': 'open' | 'closed' };

export interface CollapsibleState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  disabled: boolean;
  /** Whether the content's children are rendered (false only for `hidden="unmount"` once folded away). */
  isMounted: boolean;
  /** The element around trigger and content: `data-state`, `data-disabled`. */
  getRootProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & StateAttrs;
  /** The `<button>` that toggles it, pointing at the content. */
  getTriggerProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & StateAttrs;
  /** The content: id, fold attributes and ref, `hidden` while folded away. Render it always. */
  getContentProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & StateAttrs & { ref: RefCallback<HTMLElement> };
}

export function useCollapsible({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  collapsedHeight = 0,
  hidden = 'until-found',
  spring = false,
}: CollapsibleOptions = {}): CollapsibleState {
  const { open, setOpen, onToggle } = useDisclosure({ open: openProp, defaultOpen, onOpenChange });
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  // False during the first commit: content open from the start (or from the server) just shows.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = true;
  }, []);
  const partial = collapsedHeight > 0;
  const fold = useFold<HTMLElement>(open, readyRef, spring, partial ? collapsedHeight : 0);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  // One callback for any element type (the getter fits a <div> and a <section>), stable between renders. Find-in-page
  // found text in the closed content (`beforematch`): the browser has shown it, so it opens for real.
  const [setContent] = useState(() =>
    cleanupRef((node: HTMLElement) => {
      fold.ref.current = node;
      const reveal = () => setOpenRef.current(true);
      node.addEventListener('beforematch', reveal);
      return () => {
        node.removeEventListener('beforematch', reveal);
        fold.ref.current = null;
      };
    }),
  );
  // Folded away: hidden (a preview stays visible, readable and focusable).
  const folded = !partial && !fold.isMounted;
  const state = open ? 'open' : 'closed';

  // React writes `hidden=""` for any value; the find-in-page form is set on the element.
  useLayoutEffect(() => {
    const content = fold.ref.current;
    if (content && folded && hidden === 'until-found') content.setAttribute('hidden', 'until-found');
  }, [folded, hidden]);

  return {
    open,
    setOpen,
    toggle: onToggle,
    disabled,
    isMounted: !(folded && hidden === 'unmount'),
    getRootProps: (props) => withUserProps({ 'data-state': state, 'data-disabled': disabled || undefined }, props) as never,
    getTriggerProps: (props) =>
      withUserProps(
        {
          type: 'button',
          id: triggerId,
          'aria-expanded': open,
          'aria-controls': contentId,
          'data-state': state,
          disabled: disabled || undefined,
          onClick: () => {
            if (!disabled) onToggle();
          },
        },
        props,
      ) as never,
    getContentProps: (props) =>
      withUserProps(
        {
          ref: setContent,
          id: contentId,
          'data-state': state,
          'data-ui-fold': fold.cssFold,
          'data-partial': partial || undefined,
          hidden: folded || undefined,
          // Folding away: out of the tab order and the accessibility tree while it plays.
          inert: inertAttr(!partial && !open && !folded),
          style: partial ? ({ '--_collapsed': `${collapsedHeight}px` } as CSSProperties) : undefined,
        },
        props,
      ) as never,
  };
}
