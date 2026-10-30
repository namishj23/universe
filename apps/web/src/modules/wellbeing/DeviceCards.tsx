import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORIES,
  computeMetrics,
  DEFAULT_RULES,
  isPaused,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
  validateRules,
  type Category,
  type FocusSession,
  type Rule,
} from '@universe/wellbeing-core';
import type { wellbeing as W } from '@universe/contracts';
import { ApiRequestError } from '../../platform/api';
import { clock } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { Field, Hint, Input, Select } from '../../shell/ui/Field';
import { LoadMore } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import { Card, CardLabel, Switch } from '../../shell/ui/Widgets';
import { refresh, settingsQuery, updateSettings, uploadTotals } from './api';
import { applyImport, MAX_FILE_BYTES, readImport, totalsBatches, type Device } from './device';
import { fmtMin, LABEL, message } from './format';
import s from './Wellbeing.module.css';

const cols = (template: string) => ({ '--cols': template }) as CSSProperties;

// Each sample is its own small chunk, loaded only when imported.
const SAMPLES = import.meta.glob<unknown>(
  '../../../../../packages/wellbeing-core/samples/day-*.json',
  { import: 'default' },
);
const sampleFor = (n: string) =>
  Object.entries(SAMPLES).find(([path]) => path.endsWith(`day-${n}.json`))?.[1];

const pad = (n: number) => String(n).padStart(2, '0');
const timer = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
};
const minutes = (ms: number) => fmtMin(Math.round(ms / 60_000));

/** Active time so far: since the start, minus every pause (an open pause runs until now). */
const activeSoFar = (session: FocusSession, now: number) =>
  now -
  Date.parse(session.startedAt) -
  session.pauses.reduce((a, p) => a + ((p.to ? Date.parse(p.to) : now) - Date.parse(p.from)), 0);

/** Re-renders once a second while `on` and the page is visible; nothing runs when hidden. */
function useTick(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(id);
      id = undefined;
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [on]);
  return now;
}

/** Sends this device's daily totals, only while tracking collects. Never anything else. */
function useUpload(device: Device, summary: W.Summary, settings: W.Settings | undefined) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (data: Device['data']) => {
      const current = settings ?? queryClient.getQueryData(settingsQuery.queryKey);
      if (summary.tracking !== 'on' || !current) return null;
      const batches = totalsBatches(data, device.rules, current, summary.today);
      let stored = 0;
      for (const rows of batches) stored += (await uploadTotals(rows)).stored;
      return stored;
    },
    onSuccess: (stored) => {
      if (stored === null) toast('Tracking is paused, so nothing was sent.');
      else if (stored > 0) toast('Daily totals updated.');
      void refresh(queryClient);
    },
    onError: (err) => {
      const text =
        err instanceof ApiRequestError && err.code === 'TRACKING_PAUSED'
          ? 'Tracking is paused, so nothing was sent.'
          : message(err);
      toast(text, 'ERROR');
    },
  });
}

function Focus({
  device,
  summary,
  settings,
  upload,
}: {
  device: Device;
  summary: W.Summary;
  settings: W.Settings | undefined;
  upload: ReturnType<typeof useUpload>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { current, sessions, events } = device.data;
  const running = current !== null && !isPaused(current);
  const now = useTick(running);
  const last = sessions.at(-1);
  const metrics =
    last && !current
      ? computeMetrics(last, events, device.rules, {
          now: new Date(last.endedAt ?? Date.now()),
        })
      : null;
  const collecting = summary.tracking === 'on';
  const share = useMutation({
    mutationFn: (on: boolean) => updateSettings({ shareStudyWithHub: on }),
    onSuccess: (next) => queryClient.setQueryData(settingsQuery.queryKey, next),
    onError: (err) => toast(message(err), 'ERROR'),
  });

  const change = (result: ReturnType<typeof pauseSession>) => {
    if (result.ok) void device.update({ current: result.session });
    else toast('That focus session already changed. Try again.', 'ERROR');
  };
  const stop = async () => {
    if (!current) return;
    const result = stopSession(current, new Date());
    if (!result.ok) return change(result);
    const next = { ...device.data, sessions: [...sessions, result.session], current: null };
    await device.update({ sessions: next.sessions, current: null });
    upload.mutate(next);
  };

  return (
    <Card pad={16} gap={12} aria-label="Focus session">
      <CardLabel meta="ONLY ON THIS DEVICE">FOCUS SESSION</CardLabel>
      <span className={s.big} role="timer" aria-live="off">
        {timer(current ? activeSoFar(current, now) : 0)}
      </span>
      <span className={s.compare}>
        {current
          ? isPaused(current)
            ? 'Paused. Nothing on this device is counted until you resume.'
            : `Running since ${clock(current.startedAt)}.`
          : collecting
            ? 'Start a session to count focus time on this device.'
            : 'Resume tracking to start a focus session.'}
      </span>
      <div className={s.row}>
        {!current ? (
          <Button
            size="sm"
            disabled={!collecting || !device.ready}
            onClick={() => void device.update({ current: startSession(new Date()) })}
          >
            Start
          </Button>
        ) : (
          <>
            {isPaused(current) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => change(resumeSession(current, new Date()))}
              >
                Resume
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => change(pauseSession(current, new Date()))}
              >
                Pause
              </Button>
            )}
            <Button size="sm" disabled={upload.isPending} onClick={() => void stop()}>
              Stop
            </Button>
          </>
        )}
      </div>
      {metrics && (
        <>
          <div className={s.stats}>
            <div className={s.stat}>
              <span className={s.statLabel}>ACTIVE</span>
              <span className={s.statValue}>{minutes(metrics.activeMs)}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statLabel}>SWITCHES</span>
              <span className={s.statValue}>{metrics.switches}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statLabel}>DISTRACTING</span>
              <span className={s.statValue}>{minutes(metrics.distractingMs)}</span>
            </div>
          </div>
          {metrics.domains.length > 0 && (
            <div
              className={s.table}
              role="table"
              aria-label="Last session by site, only on this device"
              style={cols('minmax(0,1fr) 110px 64px')}
            >
              <div className={s.thead} role="row">
                <span role="columnheader">SITE</span>
                <span role="columnheader">CATEGORY</span>
                <span role="columnheader" className={s.right}>
                  TIME
                </span>
              </div>
              {metrics.domains.slice(0, 8).map((d) => (
                <div key={d.domain} className={s.tr} role="row">
                  <span role="cell" className={s.cell}>
                    {d.domain}
                    {d.distracting ? ' · distracting' : ''}
                  </span>
                  <span role="cell">{d.category}</span>
                  <span role="cell" className={s.right}>
                    {Math.round(d.ms / 60_000)}m
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <span className={s.foot}>
        <Switch
          label="Show my study minutes in the Student Hub (only to me)"
          checked={settings?.shareStudyWithHub ?? false}
          disabled={!settings || share.isPending}
          onChange={(on) => share.mutate(on)}
        />
      </span>
    </Card>
  );
}

const REASON: Record<string, string> = {
  empty: 'Enter a domain like youtube.com.',
  not_a_domain: 'Use a domain like youtube.com or *.youtube.com.',
  too_long: 'That domain is too long.',
  duplicate_pattern: 'That pattern already has a rule.',
};
const PAGE = 10;

function Rules({ device, upload }: { device: Device; upload: ReturnType<typeof useUpload> }) {
  const toast = useToast();
  const [shown, setShown] = useState(PAGE);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<Category>('study');
  const [sample, setSample] = useState('1');
  const file = useRef<HTMLInputElement>(null);
  const rules = device.rules;

  const candidate = { pattern, category, distracting: false };
  const check = pattern.trim() ? validateRules([...rules, candidate]) : null;
  const error = check && !check.ok ? REASON[check.errors[0]?.reason ?? ''] : undefined;

  const save = (next: Rule[]) => {
    const valid = validateRules(next);
    if (valid.ok) void device.update({ rules: valid.rules });
  };
  const imported = async (json: unknown, rebaseFrom?: string) => {
    const doc = readImport(json);
    if (!doc) return toast('That file has no events to import.', 'ERROR');
    const { patch, added, rejected } = applyImport(device.data, doc, {
      ...(rebaseFrom && { rebaseFrom }),
    });
    if (!added) return toast('No usable events in that file.', 'ERROR');
    await device.update(patch);
    toast(`Imported ${added} events${rejected ? `, skipped ${rejected}` : ''}.`);
    upload.mutate({ ...device.data, ...patch });
  };
  const importSample = async () => {
    const load = sampleFor(sample);
    if (!load) return;
    const json = await load();
    const now = (json as { now?: unknown }).now;
    await imported(json, typeof now === 'string' ? now : undefined);
  };
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) return toast('That file is larger than 2 MB.', 'ERROR');
    let json: unknown;
    try {
      json = JSON.parse(await picked.text());
    } catch {
      return toast("That file isn't valid JSON.", 'ERROR');
    }
    await imported(json);
  };

  return (
    <Card pad={16} gap={12} aria-label="Rules">
      <CardLabel meta="ONLY ON THIS DEVICE">RULES</CardLabel>
      <div
        className={s.table}
        role="table"
        aria-label="Categorisation rules"
        style={cols('minmax(0,1fr) 120px 44px 52px')}
      >
        <div className={s.thead} role="row">
          <span role="columnheader">PATTERN</span>
          <span role="columnheader">CATEGORY</span>
          <span role="columnheader">DISTR.</span>
          <span role="columnheader">
            <span className="uv-visually-hidden">Remove</span>
          </span>
        </div>
        {rules.slice(0, shown).map((r, i) => (
          <div key={r.pattern} className={s.tr} role="row">
            <span role="cell" className={s.cell}>
              {r.pattern}
            </span>
            <span role="cell">
              <Select
                className={s.tableSelect}
                aria-label={`Category for ${r.pattern}`}
                value={r.category}
                onChange={(e) =>
                  save(
                    rules.map((x, j) =>
                      j === i ? { ...x, category: e.target.value as Category } : x,
                    ),
                  )
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {LABEL[c]}
                  </option>
                ))}
              </Select>
            </span>
            <span role="cell">
              <Switch
                label={<span className="uv-visually-hidden">Distracting: {r.pattern}</span>}
                checked={r.distracting}
                onChange={(on) =>
                  save(rules.map((x, j) => (j === i ? { ...x, distracting: on } : x)))
                }
              />
            </span>
            <span role="cell">
              <Button variant="link" onClick={() => save(rules.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </span>
          </div>
        ))}
      </div>
      <LoadMore
        hasMore={shown < rules.length}
        loading={false}
        label={`Show more (${rules.length - shown})`}
        onClick={() => setShown((n) => n + PAGE)}
      />
      <form
        className={s.addRule}
        onSubmit={(e) => {
          e.preventDefault();
          if (check?.ok) {
            save(check.rules);
            setPattern('');
          }
        }}
      >
        <Field label="PATTERN">
          <Input
            mono
            value={pattern}
            invalid={!!error}
            aria-describedby={error ? 'rule-error' : undefined}
            placeholder="*.youtube.com"
            onChange={(e) => setPattern(e.target.value)}
          />
        </Field>
        <Field label="CATEGORY">
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" size="md" disabled={!check?.ok}>
          Add rule
        </Button>
      </form>
      {error && (
        <Hint id="rule-error" error>
          {error}
        </Hint>
      )}
      <div className={s.row}>
        <Button variant="secondary" size="sm" onClick={() => save([...DEFAULT_RULES])}>
          Reset to defaults
        </Button>
      </div>
      <div className={s.section}>
        <div className={s.row}>
          <Select
            aria-label="Sample day"
            className={s.tableSelect}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          >
            <option value="1">Day 1 · morning study</option>
            <option value="2">Day 2</option>
            <option value="3">Day 3</option>
          </Select>
          <Button size="sm" disabled={!device.ready} onClick={() => void importSample()}>
            Import sample events
          </Button>
          <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
            Import a JSON file
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="JSON file of browsing events"
            onChange={(e) => void importFile(e)}
          />
        </div>
        <span className={s.foot}>
          Sample days move to end now, so they count toward today. Events are cleaned on arrival:
          only the time, the kind and the site name are kept.
        </span>
      </div>
    </Card>
  );
}

/** Undrawn (reference: the Wellbeing cards and the drawer): focus sessions and rules. */
export function DeviceCards({
  device,
  summary,
  settings,
}: {
  device: Device;
  summary: W.Summary;
  settings: W.Settings | undefined;
}) {
  const upload = useUpload(device, summary, settings);
  return (
    <div className={s.grid} data-undrawn="">
      <Focus device={device} summary={summary} settings={settings} upload={upload} />
      <Rules device={device} upload={upload} />
    </div>
  );
}
