'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { MenuIcon, XIcon } from '../icons';
import { cx, Floating, getTabbables, useControllableState, type VirtualElement } from '../primitives';
import { IconButton } from '../basic/IconButton';
import { useSlidingIndicator } from './internal';
import './Navbar.css';
import { withRef, useId } from '../primitives/react-compat';

export interface NavbarLink {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Marks the link for the current page (aria-current). */
  active?: boolean;
}

export interface NavbarProps extends Omit<ComponentPropsWithRef<'header'>, 'children'> {
  /** Logo / product name on the left. */
  brand?: ReactNode;
  /** Navigation links in the center; each renders as an anchor with `href`, else a button. */
  links?: NavbarLink[];
  /** Right-side slot: buttons, avatar, search. Stays visible on narrow widths. */
  actions?: ReactNode;
  /** Stick to the top of the nearest scroll container. */
  sticky?: boolean;
  /** Accessible name of the links navigation. */
  label?: string;
  /** Accessible name of the button that opens the links on narrow widths. */
  menuLabel?: string;
  /** Whether the links sheet is open (narrow widths only; controlled). */
  menuOpen?: boolean;
  /** Initial state of the links sheet when uncontrolled. Opening it this way does not move focus into it. */
  defaultMenuOpen?: boolean;
  /** Called when the links sheet opens or closes. */
  onMenuOpenChange?: (open: boolean) => void;
}

const SHEET_INSET = 8;

/**
 * Below 768px of its own width (container query) the links collapse into a
 * menu button that opens them in a sheet under the bar.
 */
export const Navbar = withRef(function Navbar({
  brand,
  links = [],
  actions,
  sticky = false,
  label = 'Main',
  menuLabel = 'Menu',
  menuOpen,
  defaultMenuOpen = false,
  onMenuOpenChange,
  className,
  ...rest
}: NavbarProps) {
  const [open, setOpen] = useControllableState({ value: menuOpen, defaultValue: defaultMenuOpen, onChange: onMenuOpenChange });
  const barRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Set by the toggle: only a sheet the user opened takes focus (one open from the start must not grab it on load).
  const focusSheet = useRef(false);
  // The sheet hangs under the bar inset by SHEET_INSET on each side: a card of its own, whose edges never
  // land on the edges of whatever frames the bar (a page edge, a window border).
  const sheetAnchorRef = useRef<VirtualElement>({
    getBoundingClientRect: () => {
      const rect = barRef.current?.getBoundingClientRect() ?? new DOMRect();
      const inset = Math.min(SHEET_INSET, rect.width / 4);
      return new DOMRect(rect.left + inset, rect.top, rect.width - 2 * inset, rect.height);
    },
  });
  const sheetId = useId();
  // One active-link fill (with the theme's underline) that slides to the new link; until it is measured
  // (SSR, first paint) the active link paints its own.
  const navListRef = useRef<HTMLUListElement>(null);
  const indicator = useSlidingIndicator(navListRef, links.findIndex((link) => link.active), ':scope > li > [data-active]');

  useEffect(() => {
    if (!open) {
      focusSheet.current = false;
      return;
    }
    if (!focusSheet.current) return;
    // The sheet is portaled, so move focus into it; it is hidden until Floating measures it.
    const frame = requestAnimationFrame(() => {
      focusSheet.current = false;
      sheetRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const bar = barRef.current;
    if (!open || !bar) return;
    // Once the bar is wide enough for inline links the CSS hides the toggle; the sheet must not outlive it.
    const observer = new ResizeObserver(() => {
      const toggle = toggleRef.current;
      if (!toggle || getComputedStyle(toggle).display !== 'none') return;
      setOpen(false);
      // Focus inside the sheet would drop to <body> when it unmounts; the inline links are its equivalent.
      if (sheetRef.current?.contains(document.activeElement)) {
        bar.querySelector<HTMLElement>('.ui-navbar__nav :is(a, button)')?.focus();
      }
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [open, setOpen]);

  const renderLinks = (inSheet: boolean) => (
    <ul ref={inSheet ? undefined : navListRef} className="ui-navbar__links" data-indicator={!inSheet && indicator ? '' : undefined}>
      {!inSheet && indicator && (
        <li
          className="ui-navbar__indicator"
          aria-hidden="true"
          style={{
            width: indicator.width,
            height: indicator.height,
            transform: `translate(${indicator.left}px, ${indicator.top}px)`,
            transition: indicator.instant ? 'none' : undefined,
          }}
        />
      )}
      {links.map((link, index) => {
        const props = {
          className: 'ui-navbar__link',
          'aria-current': link.active ? ('page' as const) : undefined,
          'data-active': link.active || undefined,
          onClick: () => {
            link.onClick?.();
            if (inSheet) {
              setOpen(false);
              // The clicked link unmounts with the sheet: keep focus on the toggle instead of <body>.
              toggleRef.current?.focus();
            }
          },
        };
        return (
          <li key={index}>
            {link.href ? (
              <a href={link.href} {...props}>
                {link.label}
              </a>
            ) : (
              <button type="button" {...props}>
                {link.label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <header {...rest} className={cx('ui-navbar', className)} data-sticky={sticky || undefined}>
      <div ref={barRef} className="ui-navbar__bar">
        {brand && <div className="ui-navbar__brand">{brand}</div>}
        {links.length > 0 && (
          <nav aria-label={label} className="ui-navbar__nav">
            {renderLinks(false)}
          </nav>
        )}
        <div className="ui-navbar__actions">
          {actions}
          {links.length > 0 && (
            <IconButton
              ref={toggleRef}
              className="ui-navbar__toggle"
              label={menuLabel}
              icon={open ? <XIcon /> : <MenuIcon />}
              aria-expanded={open}
              aria-controls={open ? sheetId : undefined}
              onClick={() => {
                focusSheet.current = !open;
                setOpen(!open);
              }}
            />
          )}
        </div>
      </div>
      <Floating
        ref={sheetRef}
        id={sheetId}
        open={open}
        anchorRef={sheetAnchorRef}
        // The bar is the toggle's home: a press on it is not an outside press.
        insideRefs={[barRef]}
        placement="bottom"
        offset={8}
        matchAnchorWidth
        onDismiss={(reason) => {
          setOpen(false);
          if (reason === 'escape') toggleRef.current?.focus();
        }}
        onBlur={(event) => {
          // The sheet is portaled out of tab order, so Shift+Tab past its first link lands elsewhere on the page.
          const next = event.relatedTarget;
          if (next && next !== toggleRef.current && !event.currentTarget.contains(next)) setOpen(false);
        }}
        onKeyDown={(event) => {
          // The sheet is portaled to the end of the page: Tab past its last link (or Shift+Tab before its first) closes
          // it and continues from the toggle, as if the links sat right after it.
          if (event.key !== 'Tab' || event.defaultPrevented) return;
          const sheet = event.currentTarget;
          const items = getTabbables(sheet);
          if (document.activeElement !== (event.shiftKey ? items[0] : items[items.length - 1])) return;
          event.preventDefault();
          setOpen(false);
          const toggle = toggleRef.current;
          if (event.shiftKey || !toggle) return toggle?.focus();
          const page = getTabbables(document.body).filter((el) => !sheet.contains(el));
          (page[page.indexOf(toggle) + 1] ?? toggle).focus();
        }}
        className="ui-navbar__sheet"
      >
        <nav aria-label={label}>{renderLinks(true)}</nav>
      </Floating>
    </header>
  );
});
