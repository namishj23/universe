import type { ButtonHTMLAttributes } from 'react';
import s from './Button.module.css';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'danger' | 'link';
  /** sm 30px · md 34px · modal 36px · lg 36px wide · block 42px full width. */
  size?: 'sm' | 'md' | 'modal' | 'lg' | 'block';
}

/** Every button in the design. Disabled is opacity 0.4 plus the `disabled` attribute. */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.button, s[variant], variant !== 'link' && s[size], className)}
      {...rest}
    />
  );
}
