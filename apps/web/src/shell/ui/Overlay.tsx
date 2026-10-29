import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { cx } from './cx';
import s from './Overlay.module.css';

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers as the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
}

/**
 * Centered modal on the scrim (Radix Dialog): traps focus, closes on Esc and returns focus
 * to the element that opened it.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  narrow,
}: OverlayProps & { narrow?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.scrim} />
        <Dialog.Content
          className={cx(s.modal, narrow && s.narrow)}
          {...(!description && { 'aria-describedby': undefined })}
        >
          <Dialog.Title className={s.title}>{title}</Dialog.Title>
          {description && (
            <Dialog.Description className={s.description}>{description}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Right drawer (440px), closed by Esc, the scrim or "Close". `side="left"` for the menu. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = 'right',
  hideHead,
}: OverlayProps & { side?: 'left' | 'right'; hideHead?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.scrim} />
        <Dialog.Content
          className={cx(s.drawer, side === 'left' && s.left)}
          {...(!description && { 'aria-describedby': undefined })}
        >
          {hideHead ? (
            <Dialog.Title className="uv-visually-hidden">{title}</Dialog.Title>
          ) : (
            <div className={s.drawerHead}>
              <Dialog.Title className={s.title}>{title}</Dialog.Title>
              <Dialog.Close className={s.close}>Close</Dialog.Close>
            </div>
          )}
          {description && (
            <Dialog.Description className={s.description}>{description}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Right-aligned row of modal buttons. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className={s.actions}>{children}</div>;
}

export const ModalClose = Dialog.Close;
