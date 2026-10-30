import { useNavigate } from 'react-router';
import { useAuth } from '../../platform/auth';
import { Button } from '../ui/Button';
import { usePageTitle } from '../ui/Page';
import { PasswordFields, usePasswordChange } from './ChangePassword';
import { BrandPanel, loginStyles as s } from './Login';
import p from './Pages.module.css';

/**
 * Not drawn by the design; built from the Login screen. While the server says
 * `mustChangePassword`, every other route redirects here.
 */
export function ForcePasswordPage() {
  const { logout, passwordChanged } = useAuth();
  const navigate = useNavigate();
  usePageTitle('Choose a new password');
  const form = usePasswordChange(() => {
    passwordChanged();
    void navigate('/', { replace: true });
  });
  return (
    <div className={s.page}>
      <BrandPanel />
      <main className={s.side}>
        <form className={s.form} onSubmit={form.submit}>
          <div className={s.head}>
            <h1 className={s.title}>Choose a new password</h1>
            <span className={s.sub}>
              Your account has a temporary password. Choose your own before you continue.
            </span>
          </div>
          <PasswordFields form={form} currentLabel="TEMPORARY PASSWORD" />
          <Button type="submit" size="block" disabled={!form.ready}>
            {form.mutation.isPending ? 'Changing…' : 'Change password'}
          </Button>
          <span className={p.note}>Signs you out everywhere else.</span>
          <Button variant="link" className={s.secondary} onClick={() => void logout()}>
            Sign out
          </Button>
        </form>
      </main>
    </div>
  );
}
