import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { request, ApiRequestError } from '../../platform/api';
import { useUser } from '../../platform/auth';
import { Button } from '../ui/Button';
import { Field, FormError, Hint, Input } from '../ui/Field';
import { Modal, ModalActions } from '../ui/Overlay';
import { useToast } from '../ui/Toast';
import s from './Pages.module.css';

/** The server's rules, checked as the user types: 12–256 characters, not the email name. */
export function passwordHint(password: string, email: string) {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (password.length === 0)
    return { bad: false, text: '12 to 256 characters, not your email name.' };
  if (password.length < 12)
    return { bad: true, text: `${12 - password.length} more characters needed.` };
  if (password.length > 256) return { bad: true, text: 'At most 256 characters.' };
  if (local.length >= 3 && password.toLowerCase().includes(local))
    return { bad: true, text: 'Must not contain your email name.' };
  return { bad: false, text: '12 to 256 characters, not your email name.' };
}

/** Current + new password with live hints; `onDone` runs after the server accepts. */
export function usePasswordChange(onDone: () => void) {
  const user = useUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const hint = passwordHint(next, user.email);
  const mutation = useMutation({
    mutationFn: () =>
      request('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      onDone();
    },
  });
  const ready = current.length > 0 && next.length >= 12 && !hint.bad && !mutation.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) mutation.mutate();
  };
  const error =
    mutation.error instanceof ApiRequestError
      ? mutation.error.message
      : mutation.error
        ? "Couldn't reach UniVerse. Try again."
        : null;
  return { current, setCurrent, next, setNext, hint, ready, submit, error, mutation };
}

export function PasswordFields({
  form,
  currentLabel = 'CURRENT PASSWORD',
}: {
  form: ReturnType<typeof usePasswordChange>;
  currentLabel?: string;
}) {
  const hintId = useId();
  return (
    <>
      <Field label={currentLabel}>
        <Input
          type="password"
          autoComplete="current-password"
          value={form.current}
          onChange={(e) => form.setCurrent(e.target.value)}
        />
      </Field>
      <Field label="NEW PASSWORD">
        <Input
          type="password"
          autoComplete="new-password"
          value={form.next}
          invalid={form.hint.bad}
          aria-describedby={hintId}
          onChange={(e) => form.setNext(e.target.value)}
        />
      </Field>
      <Hint id={hintId} error={form.hint.bad}>
        {form.hint.text}
      </Hint>
      {form.error && <FormError>{form.error}</FormError>}
    </>
  );
}

/** From the account menu: same rules, keeps this session, signs out every other one. */
export function ChangePasswordModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const form = usePasswordChange(() => {
    onOpenChange(false);
    toast('Password changed. Other sessions signed out.');
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Change password">
      <form className={s.stack} onSubmit={form.submit}>
        <PasswordFields form={form} />
        <span className={s.note}>Signs you out everywhere else.</span>
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="modal" disabled={!form.ready}>
            {form.mutation.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
