import type { HTMLAttributes, RefObject } from 'react';
import { useAriaHideOutside } from '../primitives/ariaHideOutside';
import { useDisclosure, type Disclosure, type DisclosureOptions } from '../primitives/useDisclosure';
import { useDismissableLayer } from '../primitives/useDismissableLayer';
import { useFocusTrap } from '../primitives/useFocusTrap';
import { useScrollLock } from '../primitives/useScrollLock';
import { useId } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Dialog and Drawer without their markup: open state (controlled or not), the ids that name and
 * describe the dialog by its title and description, the dialog-button ARIA of the trigger and, with `layer` (the
 * default), the modal layer itself: focus moves in and is trapped, the page behind is hidden from screen readers and
 * stops scrolling, Escape and an outside press close it, focus goes back on close. The kit's Dialog and Drawer render the panel in ModalLayer, which does
 * the layer part, so they pass `layer: false`.
 */

export interface DialogOptions extends DisclosureOptions {
  /** `alertdialog` for an interruption that needs an answer. Default `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /** aria-modal: the page behind is out of reach while it is open. Default true. */
  modal?: boolean;
  /** Trap focus, lock the page scroll and close on Escape or an outside press (getDialogProps). Default true. */
  layer?: boolean;
  closeOnEscape?: boolean;
  /** Close on a press outside the dialog. Default true. */
  closeOnOutside?: boolean;
  /** What takes focus when it opens. Default: the first tabbable element, or the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes on close when the element that opened the dialog is no longer on the page. Default: the first
   * Tab stop near where that element was.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export interface DialogState extends Disclosure {
  /** Id of the title: the dialog's `aria-labelledby`. */
  titleId: string;
  /** Id of the description: the dialog's `aria-describedby`. */
  descriptionId: string;
  dialogRef: RefObject<HTMLElement | null>;
  /** The button that opens the dialog. */
  getTriggerProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A button that closes it (Cancel, ×). */
  getCloseProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /**
   * The dialog element. It is named by the title and described by the description unless your props set
   * `aria-label` / `aria-labelledby` or `aria-describedby` (an undefined value included: no description).
   */
  getDialogProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  getTitleProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  getDescriptionProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
}

export function useDialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  role = 'dialog',
  modal = true,
  layer = true,
  closeOnEscape = true,
  closeOnOutside = true,
  initialFocusRef,
  returnFocusRef,
}: DialogOptions = {}): DialogState {
  const disclosure = useDisclosure({ open: openProp, defaultOpen, onOpenChange });
  const { open, onOpen, onClose } = disclosure;
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const dialogId = `${baseId}-dialog`;
  const [dialogRef, setDialogNode] = useNodeRef();

  useScrollLock(layer && open);
  // The page behind is hidden from screen readers too: `aria-modal` alone does not stop every virtual cursor.
  // Declared before the trap, so on close the page is exposed again before focus returns to it.
  useAriaHideOutside([dialogRef], layer && modal && open);
  useFocusTrap(dialogRef, layer && open, { initialFocusRef, returnFocusRef, contain: modal });
  useDismissableLayer({ enabled: layer && open, refs: [dialogRef], onDismiss: onClose, closeOnEscape, closeOnOutside });

  return {
    ...disclosure,
    titleId,
    descriptionId,
    dialogRef,
    getTriggerProps: (props) =>
      withUserProps(
        { 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? dialogId : undefined, onClick: onOpen },
        props,
      ),
    getCloseProps: (props) => withUserProps({ onClick: onClose }, props),
    getDialogProps: (props) => {
      const named = props && ('aria-label' in props || 'aria-labelledby' in props);
      const described = props && 'aria-describedby' in props;
      return withUserProps(
        {
          ref: setDialogNode,
          id: dialogId,
          role,
          'aria-modal': modal || undefined,
          'aria-labelledby': named ? undefined : titleId,
          'aria-describedby': described ? undefined : descriptionId,
          tabIndex: -1,
        },
        props,
      ) as never;
    },
    getTitleProps: (props) => withUserProps({ id: titleId }, props),
    getDescriptionProps: (props) => withUserProps({ id: descriptionId }, props),
  };
}
