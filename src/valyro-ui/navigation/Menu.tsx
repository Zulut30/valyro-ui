'use client';

import { Fragment, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronRightIcon } from '../icons';
import { cx, Floating, type FloatingProps } from '../primitives';
import type { MenuItem, MenuLabelItem, MenuSeparatorItem } from './menu-items';
import { entryLabel, useMenu, type MenuEntry, type MenuHighlight } from './useMenu';
import { useLocale } from '../theme/ThemeProvider';
import './Menu.css';
import { withRef, useLayoutEffect } from '../primitives/react-compat';

/*
 * Shared menu renderer for DropdownMenu, ContextMenu and the collapsed menus of Breadcrumbs / Sidebar: the markup
 * of one useMenu level (navigation/useMenu.ts, in valyro-ui/headless). Not exported from the library; only the
 * item types are public.
 */

export type {
  MenuActionItem,
  MenuCheckboxItem,
  MenuRadioOption,
  MenuRadioGroup,
  MenuSeparatorItem,
  MenuLabelItem,
  MenuItem,
} from './menu-items';
export type { MenuHighlight } from './useMenu';

export interface MenuPopupProps extends Omit<FloatingProps, 'children' | 'onDismiss'> {
  items: MenuItem[];
  /** Row highlighted on open: keyboard openers start on the first/last row. */
  initialHighlight?: MenuHighlight;
  /** Move DOM focus into the menu on open (off for submenus opened by hover). */
  focusOnOpen?: boolean;
  /** Closes the whole menu tree; `returnFocus` sends focus back to whatever opened it. */
  onClose: (returnFocus: boolean) => void;
  /** Submenus only: close this level and hand focus back to the parent menu. */
  onBack?: () => void;
}

/** Remounts the menu body on every open so highlight and submenu state start fresh. */
export const MenuPopup = withRef(function MenuPopup(props: MenuPopupProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <MenuSurface key={session} {...props} />;
});

const MenuSurface = withRef(function MenuSurface({
  items,
  open,
  initialHighlight = 'none',
  focusOnOpen = true,
  onClose,
  onBack,
  className,
  ref,
  ...floatingProps
}: MenuPopupProps) {
  // The behaviour is useMenu's; Floating positions and dismisses the surface.
  const menu = useMenu({ items, open, onClose, onBack, defaultHighlight: initialHighlight, focusOnOpen, floating: false, locale: useLocale() });
  const { entries, activeIndex, direction } = menu;

  // animation="spring": one highlight glides from row to row instead of each row lighting up on its own.
  const spring = floatingProps.animation === 'spring';
  const glideRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const glide = glideRef.current;
    if (!glide) return;
    const row = activeIndex >= 0 ? document.getElementById(menu.getItemId(activeIndex)) : null;
    if (!row) {
      glide.removeAttribute('data-visible');
      return;
    }
    // The first highlight appears in place; only later moves glide.
    glide.style.transition = glide.hasAttribute('data-visible') ? '' : 'none';
    glide.style.transform = `translateY(${row.offsetTop}px)`;
    glide.style.height = `${row.offsetHeight}px`;
    glide.toggleAttribute('data-danger', row.hasAttribute('data-danger'));
    glide.setAttribute('data-visible', '');
  }, [activeIndex]);

  // Labels line up with row text when any row has an icon or check column.
  const inset = entries.some((entry) => entry.kind !== 'action' || !!entry.item.icon);
  let counter = -1;

  const renderRow = (entry: MenuEntry) => {
    const index = ++counter;
    const disabled = entry.kind === 'radio' ? !!entry.option.disabled : !!entry.item.disabled;
    const submenu = entry.kind === 'action' ? entry.item.items : undefined;
    const checked =
      entry.kind === 'checkbox'
        ? entry.item.checked
        : entry.kind === 'radio'
          ? entry.group.value === entry.option.value
          : undefined;
    const shortcut = entry.kind === 'radio' ? undefined : entry.item.shortcut;
    const href = entry.kind === 'action' && !disabled ? entry.item.href : undefined;
    const props = menu.getItemProps(index, {
      className: 'ui-menu-item',
      'data-danger': (entry.kind === 'action' && entry.item.danger) || undefined,
    });

    const content = (
      <>
        {entry.kind !== 'action' ? (
          <span className="ui-menu__indicator" aria-hidden="true">
            {checked && (entry.kind === 'checkbox' ? <CheckIcon size={14} strokeWidth={2.25} /> : <span className="ui-menu__dot" />)}
          </span>
        ) : entry.item.icon ? (
          <span className="ui-menu-item__icon">{entry.item.icon}</span>
        ) : (
          inset && <span className="ui-menu__indicator" aria-hidden="true" />
        )}
        <span className="ui-menu-item__label">{entryLabel(entry)}</span>
        {shortcut && <span className="ui-menu-item__hint ui-menu__shortcut">{shortcut}</span>}
        {submenu && (
          <span className="ui-menu-item__hint" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
        )}
      </>
    );

    const sub = submenu ? menu.getSubmenuOptions(index) : undefined;
    return (
      <Fragment key={`row-${index}`}>
        {href ? (
          <a {...props} href={href} tabIndex={-1}>
            {content}
          </a>
        ) : (
          <div {...props}>{content}</div>
        )}
        {sub && (
          <MenuPopup
            open={!!sub.open}
            anchorRef={sub.anchorRef}
            placement={direction === 'rtl' ? 'left-start' : 'right-start'}
            offset={6}
            animation={floatingProps.animation}
            items={sub.items}
            initialHighlight={sub.defaultHighlight}
            focusOnOpen={sub.focusOnOpen}
            // The row that opens it names the submenu, as a trigger names its menu.
            aria-labelledby={menu.getItemId(index)}
            onClose={onClose}
            onPointerEnter={sub.onPointerEnter}
            onBack={sub.onBack}
          />
        )}
      </Fragment>
    );
  };

  const renderItem = (item: Exclude<MenuItem, MenuSeparatorItem | MenuLabelItem>, i: number) => {
    if (item.type === 'radio') {
      return (
        <div key={i} {...menu.getGroupProps(i)}>
          {item.label && <div {...menu.getGroupLabelProps(i, { className: 'ui-menu-label' })}>{item.label}</div>}
          {item.options.map((option) => renderRow({ kind: 'radio', group: item, option }))}
        </div>
      );
    }
    return renderRow(item.type === 'checkbox' ? { kind: 'checkbox', item } : { kind: 'action', item });
  };

  // A label opens a section that runs to the next separator or label: its rows sit in a group the label names,
  // so a screen reader says "Account, group" on entering it (React Aria's Menu sections).
  const renderSections = () => {
    const blocks: ReactNode[] = [];
    let section: { index: number; label: string; rows: ReactNode[] } | null = null;
    const flush = () => {
      if (!section) return;
      const { index, label, rows } = section;
      blocks.push(
        rows.length > 0 ? (
          <div key={`section-${index}`} {...menu.getGroupProps(index)}>
            <div {...menu.getGroupLabelProps(index, { className: 'ui-menu-label' })}>{label}</div>
            {rows}
          </div>
        ) : (
          <div key={`section-${index}`} className="ui-menu-label">
            {label}
          </div>
        ),
      );
      section = null;
    };
    items.forEach((item, i) => {
      if (item.type === 'separator') {
        flush();
        blocks.push(<div key={i} {...menu.getSeparatorProps({ className: 'ui-menu-separator' })} />);
      } else if (item.type === 'label') {
        flush();
        section = { index: i, label: item.label, rows: [] };
      } else if (section) {
        section.rows.push(renderItem(item, i));
      } else {
        blocks.push(renderItem(item, i));
      }
    });
    flush();
    return blocks;
  };

  return (
    <Floating
      {...menu.getMenuProps({
        ...floatingProps,
        ref,
        className: cx('ui-menu', className),
        'data-submenu': onBack ? '' : undefined,
        'data-inset': inset || undefined,
        'data-motion': spring ? 'spring' : undefined,
      })}
      open={open}
      anchorRef={floatingProps.anchorRef}
      onDismiss={menu.dismiss}
    >
      {spring && <span ref={glideRef} className="ui-menu__glide" aria-hidden="true" />}
      {renderSections()}
    </Floating>
  );
});
