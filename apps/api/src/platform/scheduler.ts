import { logger } from './logger.js';

/** A recurring job; `fn` gets the run's start time so jobs can be tested with a frozen clock. */
export type JobFn = (now: Date) => Promise<unknown>;

interface Job {
  everyMs: number;
  fn: JobFn;
}

// ponytail: in-process timers; several API instances would each run every job (use a
// PostgreSQL advisory lock or one worker process then). Jobs here are idempotent.
const jobs = new Map<string, Job>();
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();

function run(name: string, job: Job) {
  if (running.has(name)) return; // the previous run is still going: skip this tick
  running.add(name);
  job
    .fn(new Date())
    .catch((err: unknown) => logger.error({ err, job: name }, 'scheduled job failed'))
    .finally(() => running.delete(name));
}

/**
 * Registers a job by name (registering the same name again replaces it). Nothing runs until
 * the server calls `startScheduledJobs()`, so seeds, docs and tests never start timers.
 */
export function schedule(name: string, everyMs: number, fn: JobFn): void {
  if (!/^[a-z]+\.[a-z0-9_-]+$/.test(name))
    throw new Error(`Job name must be <module>.<job>: ${name}`);
  if (!Number.isInteger(everyMs) || everyMs < 1_000) throw new Error(`Job ${name}: everyMs < 1000`);
  jobs.set(name, { everyMs, fn });
  if (timers.has(name)) startJob(name);
}

function startJob(name: string) {
  const job = jobs.get(name);
  if (!job) return;
  clearInterval(timers.get(name));
  run(name, job);
  timers.set(name, setInterval(() => run(name, job), job.everyMs).unref());
}

/** Runs every registered job now and then on its interval. Returns the stop function. */
export function startScheduledJobs(): () => void {
  for (const name of jobs.keys()) startJob(name);
  return stopScheduledJobs;
}

/** Clears every timer (called on SIGTERM/SIGINT). A run already in progress finishes. */
export function stopScheduledJobs(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}
