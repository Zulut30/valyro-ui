'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { SearchIcon } from '../icons';
import { createContainsMatcher, cx, ModalLayer, useAnnounceCount, useControllableState, useLatest } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { childElements, collectionPart, partsOf } from '../primitives/compound';
import type { SelectItem } from '../forms/listbox-items';
import { useCombobox } from '../forms/useCombobox';
import './CommandPalette.css';
import { withRef } from '../primitives/react-compat';

export interface CommandPaletteItem {
  id: string;
  label: string;
  /** Heading the command is listed under. Groups keep the order of their first command. */
  group?: string;
  icon?: ReactNode;
  /** Extra search terms that don't appear in the label. */
  keywords?: string[];
  /** Keys shown as hints, e.g. ['⌘', 'D']. Display only; hidden on touch screens, which have no keyboard. */
  shortcut?: string[];
  /** Content after the label that is not a key hint (a badge, a count, a "Pro" tag); shown on every device. */
  trailing?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface CommandPaletteProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'onSelect'> {
  /**
   * Searchable commands, listed under their group headings and filtered by label and keywords. Or compose them as
   * children: `CommandPalette.Group` and `CommandPalette.Item`.
   */
  commands?: CommandPaletteItem[];
  /** The compound form instead of `commands`: `CommandPalette.Item` elements, alone or in `CommandPalette.Group`s. */
  children?: ReactNode;
  /** Controlled open state of the modal palette. Ignored when `inline`. */
  open?: boolean;
  /** Initial open state when uncontrolled. Ignored when `inline`. */
  defaultOpen?: boolean;
  /** Called when the modal palette opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Render the palette in the page flow instead of a modal: always open, no scrim or focus trap, Escape clears
   * the query. For a command menu embedded in a page or a panel (a launcher, a search page).
   */
  inline?: boolean;
  /** Placeholder of the search field. */
  placeholder?: string;
  /** Shown when nothing matches; receives the trimmed query. */
  renderEmpty?: (query: string) => ReactNode;
  /** Overrides for the built-in English strings. */
  labels?: Partial<CommandPaletteLabels>;
}

export interface CommandPaletteItemProps extends Omit<CommandPaletteItem, 'label' | 'group'> {
  /** The command's label (plain text: the search reads it). */
  children: string;
}

export interface CommandPaletteGroupProps {
  /** Heading the commands inside are listed under. */
  heading: string;
  /** Its `CommandPalette.Item` elements. */
  children?: ReactNode;
}

/** A command of the compound form (`CommandPalette.Item`): the props of a CommandPaletteItem, label as children. */
export const CommandPaletteItemPart = collectionPart<CommandPaletteItemProps>('CommandPalette.Item');
/** Commands under one heading (`CommandPalette.Group`). */
export const CommandPaletteGroup = collectionPart<CommandPaletteGroupProps>('CommandPalette.Group');

function commandsFromParts(children: ReactNode): CommandPaletteItem[] {
  const command = (props: CommandPaletteItemProps, group?: string): CommandPaletteItem => {
    const { children: label, ...rest } = props;
    return group === undefined ? { ...rest, label } : { ...rest, label, group };
  };
  return childElements(children).flatMap((child) => {
    if (child.type === CommandPaletteItemPart) return [command(child.props as CommandPaletteItemProps)];
    if (child.type !== CommandPaletteGroup) return [];
    const { heading, children: items } = child.props as CommandPaletteGroupProps;
    return partsOf<CommandPaletteItemProps>(items, CommandPaletteItemPart).map((item) => command(item.props, heading));
  });
}

export interface CommandPaletteLabels {
  /** Accessible name of the results list. */
  results: string;
  /** Footer hints. */
  navigate: string;
  run: string;
  close: string;
  /** Escape key cap. */
  escapeKey: string;
  /** Read to screen readers once the typing pauses: how many commands match ("3 results available"). */
  resultCount?: (count: number) => string;
}

export const defaultCommandPaletteLabels: Required<CommandPaletteLabels> = {
  results: 'Commands',
  navigate: 'Navigate',
  run: 'Run',
  close: 'Close',
  escapeKey: 'esc',
  resultCount: (count) => `${count} ${count === 1 ? 'result' : 'results'} available`,
};

/**
 * Commands whose label or keywords contain every whitespace-separated term of the query, ignoring case and accents
 * the way `locale` does ("cafe" finds "Café").
 */
export function filterCommands(commands: CommandPaletteItem[], query: string, locale?: string) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return commands;
  const contains = createContainsMatcher(locale);
  return commands.filter((command) => {
    const haystack = [command.label, ...(command.keywords ?? [])].join(' ');
    return terms.every((term) => contains(haystack, term));
  });
}

interface CommandGroup {
  heading: string;
  commands: CommandPaletteItem[];
}

function groupCommands(commands: CommandPaletteItem[]): CommandGroup[] {
  const groups = new Map<string, CommandPaletteItem[]>();
  for (const command of commands) {
    const heading = command.group ?? '';
    const list = groups.get(heading);
    if (list) list.push(command);
    else groups.set(heading, [command]);
  }
  return Array.from(groups, ([heading, list]) => ({ heading, commands: list }));
}

/** Results in display order: grouped, so keyboard order matches what is on screen. */
function arrange(commands: CommandPaletteItem[], query: string, locale?: string) {
  return { groups: groupCommands(filterCommands(commands, query, locale)) };
}

/** Toggles the palette with ⌘K (macOS) / Ctrl+K anywhere on the page. */
export function useCommandPaletteHotkey(setOpen: Dispatch<SetStateAction<boolean>>) {
  const setOpenRef = useLatest(setOpen);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Modifiers first: autofill fires keydown events without a `key`.
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key?.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpenRef.current((open) => !open);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpenRef]);
}

export const CommandPalette = withRef(function CommandPalette({
  commands: commandsProp,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  inline = false,
  placeholder = 'Type a command or search…',
  renderEmpty = (query) => (query ? `No results for “${query}”` : 'No commands'),
  labels,
  className,
  'aria-label': ariaLabel = 'Command palette',
  ...rest
}: CommandPaletteProps) {
  const commands = useMemo(() => commandsProp ?? commandsFromParts(children), [commandsProp, children]);
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const inputRef = useRef<HTMLInputElement>(null);

  if (inline) {
    return (
      <div {...rest} role="group" aria-label={ariaLabel} className={cx('ui-command-palette', className)} data-inline="">
        <PaletteBody
          commands={commands}
          placeholder={placeholder}
          renderEmpty={renderEmpty}
          labels={{ ...defaultCommandPaletteLabels, ...labels }}
          inputRef={inputRef}
        />
      </div>
    );
  }

  return (
    <ModalLayer
      {...rest}
      open={open}
      onClose={() => setOpen(false)}
      placement="top"
      initialFocusRef={inputRef}
      aria-label={ariaLabel}
      className={cx('ui-command-palette', className)}
    >
      <PaletteBody
        commands={commands}
        placeholder={placeholder}
        renderEmpty={renderEmpty}
        labels={{ ...defaultCommandPaletteLabels, ...labels }}
        inputRef={inputRef}
        onClose={() => setOpen(false)}
      />
    </ModalLayer>
  );
}, { Item: CommandPaletteItemPart, Group: CommandPaletteGroup });

interface PaletteBodyProps {
  commands: CommandPaletteItem[];
  placeholder: string;
  renderEmpty: (query: string) => ReactNode;
  labels: Required<CommandPaletteLabels>;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Closes the modal palette; absent inline, where running a command clears the query instead. */
  onClose?: () => void;
}

/* Mounted per open (ModalLayer unmounts its children when closed), so the query starts empty. */
function PaletteBody({ commands, placeholder, renderEmpty, labels, inputRef, onClose }: PaletteBodyProps) {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const locale = useLocale();
  const groups = useMemo(() => arrange(commands, query, locale).groups, [commands, query, locale]);
  // The commands as useCombobox options, already filtered and grouped (groups keep the order of their first match).
  const items = useMemo<SelectItem[]>(
    () =>
      groups.map((group) => ({
        label: group.heading,
        options: group.commands.map((command) => ({ value: command.id, label: command.label, disabled: command.disabled })),
      })),
    [groups],
  );

  // The behaviour is useCombobox's (valyro-ui/headless) as a command menu: always open, the highlighted row is the
  // selected one, a pick runs the command instead of filling the field.
  const combobox = useCombobox({
    items,
    filter: false,
    inputValue: query,
    onInputValueChange: setQuery,
    open: true,
    selectionMode: 'none',
    onSelect: (option) => run(byId.get(option.value)),
    floating: false,
  });
  const empty = combobox.listbox.options.length === 0;
  // Filtering is silent for screen readers that do not follow aria-activedescendant: the count is read out
  // (no matches is already a status message below).
  useAnnounceCount(combobox.listbox.options.filter((option) => !option.disabled).length, {
    active: query.trim() !== '',
    message: labels.resultCount,
    key: query,
  });

  function run(command: CommandPaletteItem | undefined) {
    if (!command || command.disabled) return;
    if (onClose) onClose();
    else if (query) combobox.search('');
    command.onSelect?.();
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Inline there is nothing to close: Escape clears the query instead.
    if (event.key !== 'Escape' || onClose || !query || event.nativeEvent.isComposing) return;
    event.preventDefault();
    combobox.search('');
  };

  let counter = -1;

  return (
    <>
      <div className="ui-command-palette__search">
        <span className="ui-field__icon">
          <SearchIcon size={18} />
        </span>
        <input
          {...combobox.getInputProps({
            ref: inputRef,
            className: 'ui-field__input ui-command-palette__input',
            autoCorrect: 'off',
            placeholder,
            onKeyDown: handleKeyDown,
          })}
        />
        {onClose && <kbd className="ui-kbd ui-command-palette__esc">{labels.escapeKey}</kbd>}
      </div>
      {/* The listbox has no items to read when nothing matches: say so in a live region instead. */}
      <div className="ui-sr-only" role="status">
        {empty ? renderEmpty(query.trim()) : null}
      </div>
      <div {...combobox.getListboxProps({ 'aria-label': labels.results, className: 'ui-command-palette__list' })}>
        {empty ? (
          <div className="ui-command-palette__empty" role="presentation" aria-hidden="true">
            {renderEmpty(query.trim())}
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.heading} {...combobox.getGroupProps(groupIndex, { className: 'ui-command-palette__group' })}>
              {group.heading && <div {...combobox.getGroupLabelProps(groupIndex, { className: 'ui-menu-label' })}>{group.heading}</div>}
              {group.commands.map((command) => {
                const index = ++counter;
                return (
                  <div key={command.id} {...combobox.getOptionProps(index, { className: 'ui-menu-item ui-command-palette__option' })}>
                    {command.icon && <span className="ui-menu-item__icon">{command.icon}</span>}
                    <span className="ui-menu-item__label">{command.label}</span>
                    {command.trailing != null && <span className="ui-command-palette__trailing">{command.trailing}</span>}
                    {command.shortcut && (
                      <span className="ui-command-palette__shortcut" aria-hidden="true">
                        {command.shortcut.map((key) => (
                          <kbd key={key} className="ui-kbd">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="ui-command-palette__footer" aria-hidden="true">
        <span className="ui-command-palette__hint">
          <kbd className="ui-kbd">↑</kbd>
          <kbd className="ui-kbd">↓</kbd>
          {labels.navigate}
        </span>
        <span className="ui-command-palette__hint">
          <kbd className="ui-kbd">↵</kbd>
          {labels.run}
        </span>
        {onClose && (
          <span className="ui-command-palette__hint">
            <kbd className="ui-kbd">{labels.escapeKey}</kbd>
            {labels.close}
          </span>
        )}
      </div>
    </>
  );
}
