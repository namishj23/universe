import { useEffect, useState, type FormEvent } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  AdminUser,
  AuditEntry,
  CreateUserResponse,
  pageOf,
  ResetPasswordResponse,
  Role,
  type AdminUser as AdminUserT,
  type AuditEntry as AuditEntryT,
} from '@universe/contracts';
import { api, ApiRequestError } from '../../platform/api';
import { useUser } from '../../platform/auth';
import { clock, seenLabel } from '../format';
import { Button } from '../ui/Button';
import { Chips, TabLinks } from '../ui/Controls';
import { cx } from '../ui/cx';
import { Field, FormError, Input, Select } from '../ui/Field';
import { Modal, ModalActions } from '../ui/Overlay';
import { PageHeader, toneClass } from '../ui/Page';
import { Empty, ErrorBox, Loading } from '../ui/States';
import { LoadMore, Row, Table, TableNote } from '../ui/Table';
import { useToast } from '../ui/Toast';
import s from './Admin.module.css';
import p from './Pages.module.css';

const USERS_KEY = ['admin', 'users'] as const;
const UsersPage = pageOf(AdminUser);
const AuditPage = pageOf(AuditEntry);
const ROLES = Role.options;

/** `value`, settled for `ms`: search sends one request per pause, not per keystroke. */
function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const query = (params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
};

const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Couldn't reach UniVerse. Try again.";

/** The temporary password, shown once, then gone from memory when the modal closes. */
function Secret({ password, onDone }: { password: string; onDone: () => void }) {
  return (
    <>
      <span className={s.secret}>{password}</span>
      <ModalActions>
        <Button size="modal" onClick={onDone}>
          Done
        </Button>
      </ModalActions>
    </>
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function NewUserModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api('/api/admin/users', CreateUserResponse, {
        method: 'POST',
        body: { name: name.trim(), email: email.trim().toLowerCase(), role },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: USERS_KEY }),
    onError: (err) =>
      setError(
        err instanceof ApiRequestError && err.status === 409
          ? 'An account with this email already exists.'
          : message(err),
      ),
  });
  const reset = () => {
    setName('');
    setEmail('');
    setRole('student');
    setError('');
    create.reset();
  };
  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !EMAIL.test(email.trim())) {
      setError('Enter a name and a valid email.');
      return;
    }
    create.mutate();
  };
  if (create.data)
    return (
      <Modal
        open={open}
        onOpenChange={close}
        title="User created"
        description={`Temporary password for ${create.data.user.name}. It is shown once; they must change it at first sign-in.`}
      >
        <Secret password={create.data.temporaryPassword} onDone={() => close(false)} />
      </Modal>
    );
  return (
    <Modal open={open} onOpenChange={close} title="New user">
      <form className={p.stack} onSubmit={submit} noValidate>
        <Field label="NAME">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="EMAIL">
          <Input
            mono
            type="email"
            placeholder="name@spit.ac.in"
            value={email}
            autoComplete="off"
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
          />
        </Field>
        <Field label="ROLE">
          <Select value={role} onChange={(e) => setRole(Role.parse(e.target.value))}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        {error && <FormError>{error}</FormError>}
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" size="modal" disabled={create.isPending}>
            Create user
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

/** Not drawn by the design; same modal style. Change role, or reset to a temporary password. */
function ManageUserModal({ user, onClose }: { user: AdminUserT; onClose: () => void }) {
  const me = useUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState<Role>(user.role);
  const self = user.id === me.id;
  const done = () => void queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const changeRole = useMutation({
    mutationFn: () =>
      api(`/api/admin/users/${user.id}`, AdminUser, { method: 'PATCH', body: { role } }),
    onSuccess: (u) => {
      done();
      toast(`${u.name} is now ${u.role}. Their sessions were closed.`);
      onClose();
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const reset = useMutation({
    mutationFn: () =>
      api(`/api/admin/users/${user.id}/reset-password`, ResetPasswordResponse, { method: 'POST' }),
    onSuccess: done,
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const onOpenChange = (o: boolean) => !o && onClose();
  if (reset.data)
    return (
      <Modal
        open
        onOpenChange={onOpenChange}
        title="Password reset"
        description={`Temporary password for ${user.name}. It is shown once; they must change it at their next sign-in. Their sessions were closed.`}
      >
        <Secret password={reset.data.temporaryPassword} onDone={onClose} />
      </Modal>
    );
  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={user.name}
      description={<span className={s.meta}>{user.email}</span>}
    >
      {self && (
        <span className={p.note}>
          You can't change your own role or reset your own password here. Use Change password in the
          account menu.
        </span>
      )}
      <div className={s.manageRow}>
        <div className={s.grow}>
          <Field label="ROLE">
            <Select
              value={role}
              disabled={self}
              onChange={(e) => setRole(Role.parse(e.target.value))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          size="modal"
          disabled={self || role === user.role || changeRole.isPending}
          onClick={() => changeRole.mutate()}
        >
          Change role
        </Button>
      </div>
      <span className={p.note}>
        Reset password gives them a new temporary password and signs them out everywhere.
      </span>
      <ModalActions>
        <Button variant="secondary" size="modal" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="destructive"
          size="modal"
          disabled={self || reset.isPending}
          onClick={() => reset.mutate()}
        >
          Reset password
        </Button>
      </ModalActions>
    </Modal>
  );
}

const USER_COLUMNS = 'minmax(0,1.2fr) minmax(0,1.4fr) 100px 90px 100px 110px';

function Users({ onNewUser }: { onNewUser: () => void }) {
  const me = useUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | Role>('all');
  const [managing, setManaging] = useState<AdminUserT | null>(null);
  const search = useDebounced(q.trim());
  const now = new Date();
  const users = useInfiniteQuery({
    queryKey: [...USERS_KEY, search, role],
    queryFn: ({ pageParam, signal }) =>
      api(
        `/api/admin/users?${query({ limit: '20', q: search, role: role === 'all' ? null : role, cursor: pageParam })}`,
        UsersPage,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (u: AdminUserT) =>
      api(`/api/admin/users/${u.id}`, AdminUser, {
        method: 'PATCH',
        body: { isActive: !u.isActive },
      }),
    onSuccess: (u) => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast(
        u.isActive
          ? `${u.name} reactivated.`
          : `${u.name} deactivated. Their sessions were closed.`,
      );
    },
    // CANNOT_CHANGE_SELF and LAST_ADMIN carry the server's own sentence.
    onError: (err) => toast(message(err), 'ERROR'),
  });

  const filters = (
    <div className={s.filters}>
      <Input
        className={s.search}
        type="search"
        aria-label="Search name or email"
        placeholder="Search name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Chips
        label="Filter by role"
        look="square"
        tight
        choices={[{ id: 'all' as const, label: 'all' }, ...ROLES.map((r) => ({ id: r, label: r }))]}
        value={role}
        onChange={setRole}
      />
    </div>
  );

  // As in the design, the loading and error panels replace the filters too.
  if (users.isPending) return <Loading what="users" />;
  if (users.isError)
    return <ErrorBox error={users.error} what="users" onRetry={() => void users.refetch()} />;
  const rows = users.data.pages.flatMap((pg) => pg.items);
  const filtered = search !== '' || role !== 'all';
  if (rows.length === 0 && !filtered)
    return (
      <Empty
        title="No users match"
        body="Create the first account or clear your filters."
        action={{ label: 'New user', onClick: onNewUser }}
      />
    );

  return (
    <>
      {filters}
      <Table
        label="Users"
        columns={USER_COLUMNS}
        minWidth="720px"
        headers={[
          'NAME',
          'EMAIL',
          'ROLE',
          'STATUS',
          'LAST SEEN',
          <span key="a" className="uv-visually-hidden">
            Actions
          </span>,
        ]}
      >
        {rows.map((u) => {
          const self = u.id === me.id;
          return (
            <Row key={u.id} className={cx(!u.isActive && s.inactive)}>
              <span role="cell">
                <button type="button" className={s.nameButton} onClick={() => setManaging(u)}>
                  {u.name}
                </button>
              </span>
              <span role="cell" className={s.email}>
                {u.email}
              </span>
              <span role="cell" className={s.role}>
                {u.role}
              </span>
              <span role="cell" className={cx(s.status, toneClass(u.isActive ? 'ok' : 'neutral'))}>
                {u.isActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
              <span role="cell" className={s.seen}>
                {seenLabel(u.lastLoginAt, now)}
              </span>
              <span role="cell" style={{ display: 'grid' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={self || toggle.isPending}
                  onClick={() => toggle.mutate(u)}
                >
                  {self ? 'You' : u.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </span>
            </Row>
          );
        })}
        {rows.length === 0 && <TableNote>No users match this search.</TableNote>}
      </Table>
      <LoadMore
        hasMore={users.hasNextPage}
        loading={users.isFetchingNextPage}
        onClick={() => void users.fetchNextPage()}
      />
      {managing && <ManageUserModal user={managing} onClose={() => setManaging(null)} />}
    </>
  );
}

type Prefix = 'all' | 'auth' | 'admin' | 'exam' | 'platform';
const PREFIXES: Prefix[] = ['all', 'auth', 'admin', 'exam', 'platform'];

/** What an entry was about, in words: never more than the metadata already holds. */
function targetText(e: AuditEntryT) {
  const m = (typeof e.metadata === 'object' && e.metadata) || {};
  if ('recipients' in m && typeof m.recipients === 'number') return `${m.recipients} recipients`;
  if ('emailHmac' in m && typeof m.emailHmac === 'string')
    return `email hmac ${m.emailHmac.slice(0, 4)}…`;
  if (e.action === 'auth.login' || e.action === 'auth.logout') return '—';
  if (e.targetType === 'user' && e.targetId && e.targetId === e.actor?.id) return 'self';
  if (e.targetType && e.targetId)
    return `${e.targetType} ${e.targetId.length > 12 ? `${e.targetId.slice(0, 8)}…` : e.targetId}`;
  return '—';
}

function Audit() {
  const [prefix, setPrefix] = useState<Prefix>('all');
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit', prefix],
    queryFn: ({ pageParam, signal }) =>
      api(
        `/api/admin/audit?${query({ limit: '20', actionPrefix: prefix === 'all' ? null : prefix, cursor: pageParam })}`,
        AuditPage,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const chips = (
    <Chips
      label="Filter by action"
      look="mono"
      tight
      choices={PREFIXES.map((x) => ({ id: x, label: x === 'all' ? 'all' : `${x}.*` }))}
      value={prefix}
      onChange={setPrefix}
    />
  );
  if (audit.isPending) return <Loading what="the audit log" />;
  if (audit.isError)
    return (
      <ErrorBox error={audit.error} what="the audit log" onRetry={() => void audit.refetch()} />
    );
  const rows = audit.data.pages.flatMap((pg) => pg.items);
  if (rows.length === 0 && prefix === 'all')
    return (
      <Empty
        title="No audit entries yet"
        body="Sign-ins, admin actions and reviews are recorded here as they happen."
      />
    );
  return (
    <>
      {chips}
      <Table
        label="Audit log"
        columns="70px minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) 100px"
        minWidth="640px"
        rowPad="9px 14px"
        align="baseline"
        headers={['TIME', 'ACTOR', 'ACTION', 'TARGET', 'REQUEST']}
      >
        {rows.map((e) => (
          <Row key={e.id}>
            <span role="cell" className={s.time}>
              {clock(e.createdAt)}
            </span>
            <span role="cell" className={s.actor}>
              {e.actor?.name ?? '(unknown)'}
            </span>
            <span role="cell" className={s.action}>
              {e.action}
            </span>
            <span role="cell" className={s.target}>
              {targetText(e)}
            </span>
            <span
              role="cell"
              className={s.request}
              title={e.requestId ?? undefined}
              data-request-id=""
            >
              {e.requestId ? `req_${e.requestId.slice(0, 6)}` : '—'}
            </span>
          </Row>
        ))}
        {rows.length === 0 && <TableNote>No entries for this filter.</TableNote>}
      </Table>
      <LoadMore
        hasMore={audit.hasNextPage}
        loading={audit.isFetchingNextPage}
        onClick={() => void audit.fetchNextPage()}
      />
      <span className={s.footnote}>
        Append-only. Entries cannot be edited or deleted, by anyone.
      </span>
    </>
  );
}

export function AdminPage({ tab }: { tab: 'users' | 'audit' }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="PLATFORM · ADMIN"
        title="Admin"
        action={
          <Button size="lg" onClick={() => setCreating(true)}>
            New user
          </Button>
        }
      >
        <TabLinks
          label="Admin sections"
          tabs={[
            { to: '/admin', label: 'Users' },
            { to: '/admin/audit', label: 'Audit log' },
          ]}
        />
      </PageHeader>
      {tab === 'users' ? <Users onNewUser={() => setCreating(true)} /> : <Audit />}
      <NewUserModal open={creating} onOpenChange={setCreating} />
    </>
  );
}
