import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import s from './Field.module.css';

/** A mono UPPERCASE label wrapping its control. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 40px / 15px, as on the login form. */
  large?: boolean;
  mono?: boolean;
  invalid?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { large, mono, invalid, readOnly, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      className={cx(
        s.input,
        large && s.large,
        mono && s.mono,
        readOnly && s.readOnly,
        invalid && s.invalid,
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(s.input, s.select, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(s.input, s.textarea, className)} {...rest} />;
}

/** Help text under a field; `error` turns it red. */
export function Hint({
  error,
  id,
  children,
}: {
  error?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <span id={id} className={cx(s.hint, error && s.hintError)}>
      {children}
    </span>
  );
}

/** A form-level error line (role="alert"). */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <span role="alert" className={s.error}>
      {children}
    </span>
  );
}

export const fieldStyles = s;
