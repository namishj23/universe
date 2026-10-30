import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hub } from '@universe/contracts';
import type { z } from 'zod';
import { usePasswordChange } from '../../shell/pages/ChangePassword';
import { Button } from '../../shell/ui/Button';
import { Field, FormError, Hint, Input, Select } from '../../shell/ui/Field';
import { ErrorBox, Loading } from '../../shell/ui/States';
import { useToast } from '../../shell/ui/Toast';
import { Card, CardLabel, Switch } from '../../shell/ui/Widgets';
import { getProfile, KEYS, message, saveProfile } from './api';
import { HUB_WHAT } from './text';
import s from './Hub.module.css';

type HubYear = z.infer<typeof hub.Year>;

const BRANCHES = [
  'Computer Engineering',
  'Information Technology',
  'Electronics and Telecommunication',
];
const YEARS: Record<HubYear, string> = {
  FE: 'FE (first year)',
  SE: 'SE (second year)',
  TE: 'TE (third year)',
  BE: 'BE (final year)',
};
const list = (text: string) =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const joined = (items: string[]) => items.join(', ');

type Draft = {
  branch: string;
  year: HubYear | '';
  interests: string;
  skills: string;
  targetRole: string;
  targetCompanies: string;
  placementDeadline: string;
  isPeerMentor: boolean;
  mentorExpertise: string;
  mentorDepartment: string;
  mentorCapacity: number;
};
const draftOf = (p: hub.HubProfile): Draft => ({
  branch: p.branch ?? '',
  year: p.year ?? '',
  interests: joined(p.interests),
  skills: joined(p.skills),
  targetRole: p.targetRole ?? '',
  targetCompanies: joined(p.targetCompanies),
  placementDeadline: p.placementDeadline ?? '',
  isPeerMentor: p.isPeerMentor,
  mentorExpertise: joined(p.mentorExpertise),
  mentorDepartment: p.mentorDepartment ?? '',
  mentorCapacity: p.mentorCapacity,
});

/** The design's CHANGE PASSWORD card, on U1's change-password call and live rules. */
function PasswordCard() {
  const toast = useToast();
  const hintId = useId();
  const form = usePasswordChange(() => toast('Password changed. Other sessions signed out.'));
  return (
    <form onSubmit={form.submit}>
      <Card pad={18} gap={12}>
        <CardLabel>CHANGE PASSWORD</CardLabel>
        <Input
          type="password"
          aria-label="Current password"
          placeholder="Current password"
          autoComplete="current-password"
          value={form.current}
          onChange={(e) => form.setCurrent(e.target.value)}
        />
        <Input
          type="password"
          aria-label="New password"
          placeholder="New password"
          autoComplete="new-password"
          aria-describedby={hintId}
          invalid={form.hint.bad}
          value={form.next}
          onChange={(e) => form.setNext(e.target.value)}
        />
        <Hint id={hintId} error={form.hint.bad}>
          {form.hint.text}
        </Hint>
        {form.error && <FormError>{form.error}</FormError>}
        <Button type="submit" variant="secondary" size="lg" disabled={!form.ready}>
          {form.mutation.isPending ? 'Changing…' : 'Change password'}
        </Button>
        <span className={s.footnote}>Signs you out everywhere else.</span>
      </Card>
    </form>
  );
}

export function Profile() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const profile = useQuery({ queryKey: KEYS.profile, queryFn: ({ signal }) => getProfile(signal) });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (profile.data && !draft) setDraft(draftOf(profile.data));
  }, [profile.data, draft]);
  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveProfile({
        branch: d.branch || null,
        year: d.year || null,
        interests: list(d.interests),
        skills: list(d.skills),
        ...(profile.data?.user.role === 'student' && {
          targetRole: d.targetRole.trim() || null,
          targetCompanies: list(d.targetCompanies),
          placementDeadline: d.placementDeadline || null,
          isPeerMentor: d.isPeerMentor,
        }),
        ...((profile.data?.user.role === 'mentor' || d.isPeerMentor) && {
          mentorExpertise: list(d.mentorExpertise),
          mentorDepartment: d.mentorDepartment.trim() || null,
          mentorCapacity: d.mentorCapacity,
        }),
      }),
    onSuccess: (p) => {
      queryClient.setQueryData(KEYS.profile, p);
      setDraft(draftOf(p));
      void queryClient.invalidateQueries({ queryKey: KEYS.mentors });
      toast('Profile saved. Mentor ranking updated.');
    },
  });

  if (profile.isError)
    return (
      <ErrorBox error={profile.error} what={HUB_WHAT} onRetry={() => void profile.refetch()} />
    );
  const p = profile.data;
  if (!p || !draft) return <Loading what={HUB_WHAT} />;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(draft);
  };
  const mentorFields = p.user.role === 'mentor' || draft.isPeerMentor;
  return (
    <>
      <div className={s.profile}>
        <form onSubmit={submit}>
          <Card pad={18} gap={14}>
            <div className={s.pair}>
              <Field label="NAME">
                <Input readOnly value={p.user.name} />
              </Field>
              <Field label="EMAIL">
                <Input readOnly mono value={p.user.email} />
              </Field>
              <Field label="BRANCH">
                <Select value={draft.branch} onChange={(e) => set('branch', e.target.value)}>
                  {!BRANCHES.includes(draft.branch) && (
                    <option value={draft.branch}>{draft.branch || '—'}</option>
                  )}
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              </Field>
              <Field label="YEAR">
                <Select
                  value={draft.year}
                  onChange={(e) => set('year', hub.Year.safeParse(e.target.value).data ?? '')}
                >
                  {draft.year === '' && <option value="">—</option>}
                  {hub.Year.options.map((y) => (
                    <option key={y} value={y}>
                      {YEARS[y]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="INTERESTS · USED FOR MENTOR RANKING">
              <Input value={draft.interests} onChange={(e) => set('interests', e.target.value)} />
            </Field>
            {save.isError && <FormError>{message(save.error)}</FormError>}
            <div className={s.end}>
              <Button type="submit" size="lg" disabled={save.isPending}>
                Save profile
              </Button>
            </div>
          </Card>
        </form>
        <PasswordCard />
      </div>
      {/* Not drawn by the design: the rest of the API's profile, below the designed grid. */}
      <form onSubmit={submit} data-undrawn="">
        <Card pad={18} gap={14}>
          <CardLabel>{p.user.role === 'student' ? 'PLACEMENT GOALS' : 'MENTOR PROFILE'}</CardLabel>
          <Field label="SKILLS">
            <Input value={draft.skills} onChange={(e) => set('skills', e.target.value)} />
          </Field>
          {p.user.role === 'student' && (
            <>
              <div className={s.pair}>
                <Field label="TARGET ROLE">
                  <Input
                    value={draft.targetRole}
                    maxLength={80}
                    onChange={(e) => set('targetRole', e.target.value)}
                  />
                </Field>
                <Field label="PLACEMENT DEADLINE">
                  <Input
                    type="date"
                    mono
                    value={draft.placementDeadline}
                    onChange={(e) => set('placementDeadline', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="TARGET COMPANIES">
                <Input
                  value={draft.targetCompanies}
                  onChange={(e) => set('targetCompanies', e.target.value)}
                />
              </Field>
              <Switch
                label="Offer peer mentoring to juniors"
                checked={draft.isPeerMentor}
                onChange={(v) => set('isPeerMentor', v)}
              />
            </>
          )}
          {mentorFields && (
            <>
              <Field label="EXPERTISE · TOPICS YOU MENTOR">
                <Input
                  value={draft.mentorExpertise}
                  onChange={(e) => set('mentorExpertise', e.target.value)}
                />
              </Field>
              <div className={s.pair}>
                <Field label="DEPARTMENT">
                  <Input
                    value={draft.mentorDepartment}
                    maxLength={80}
                    onChange={(e) => set('mentorDepartment', e.target.value)}
                  />
                </Field>
                <Field label="MENTEES AT A TIME">
                  <Input
                    type="number"
                    mono
                    min={0}
                    max={20}
                    value={draft.mentorCapacity}
                    onChange={(e) => set('mentorCapacity', Number(e.target.value))}
                  />
                </Field>
              </div>
            </>
          )}
          <span className={s.footnote}>Lists are comma separated.</span>
          <div className={s.end}>
            <Button type="submit" size="lg" disabled={save.isPending}>
              Save details
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
