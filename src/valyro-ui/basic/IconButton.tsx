'use client';

import { useContext, type MouseEvent, type ReactNode } from 'react';
import { composeHandlers, cx, isMotionReduced } from '../primitives';
import { Button, type ButtonProps } from './Button';
import './IconButton.css';
import { TooltipTriggerContext } from './Tooltip';
import { withRef } from '../primitives/react-compat';

export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'children' | 'fullWidth' | 'asChild'> {
  /** The icon shown as the button's only content. */
  icon: ReactNode;
  /** Required accessible name (used as aria-label, and as the native title unless wrapped in a Tooltip). */
  label: string;
  /** Circle instead of the theme's default button radius. */
  round?: boolean;
  /**
   * On each click the icon pops and a ring of particles bursts out in its colour — confirmation for a
   * like or a favourite (show the new state too, e.g. a filled icon). Skipped under reduced motion.
   */
  burst?: boolean;
}

const PARTICLES = 8;

/**
 * Sends a ring of particles out of `button` and pops its icon — CSS animations (IconButton.css): the pop restarts
 * on every click under a new name (data-burst a / b), each particle flies to its own --_dx / --_dy and removes
 * itself when it lands.
 */
function burstFrom(button: HTMLElement) {
  if (isMotionReduced(button)) return;
  button.setAttribute('data-burst', button.getAttribute('data-burst') === 'a' ? 'b' : 'a');
  const reach = button.offsetWidth * 0.8;
  for (let i = 0; i < PARTICLES; i++) {
    const angle = ((i + Math.random() * 0.4) / PARTICLES) * Math.PI * 2;
    const distance = reach * (0.75 + Math.random() * 0.35);
    const particle = document.createElement('span');
    particle.className = 'ui-icon-button__particle';
    particle.setAttribute('aria-hidden', 'true');
    particle.style.setProperty('--_dx', `${(Math.cos(angle) * distance).toFixed(1)}px`);
    particle.style.setProperty('--_dy', `${(Math.sin(angle) * distance).toFixed(1)}px`);
    const remove = () => particle.remove();
    particle.addEventListener('animationend', remove);
    particle.addEventListener('animationcancel', remove);
    button.append(particle);
  }
}

export const IconButton = withRef(function IconButton({ icon, label, round, pill, burst = false, variant = 'ghost', className, title, onClick, ...rest }: IconButtonProps) {
  // A surrounding <Tooltip> already shows the label; a native title would double it.
  const inTooltip = useContext(TooltipTriggerContext);
  return (
    <Button
      {...rest}
      variant={variant}
      aria-label={label}
      title={title ?? (inTooltip ? undefined : label)}
      data-icon-only=""
      // `pill` (inherited from Button) means the same as `round` here.
      pill={round ?? pill}
      className={cx('ui-icon-button', className)}
      leftIcon={icon}
      onClick={burst ? composeHandlers(onClick, (event: MouseEvent<HTMLButtonElement>) => burstFrom(event.currentTarget)) : onClick}
    />
  );
});
