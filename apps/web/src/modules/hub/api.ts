import { z } from 'zod';
import { FileRecord, hub } from '@universe/contracts';
import { api, ApiRequestError, request } from '../../platform/api';

/** Every Student Hub call, in one place. Query keys start with 'hub'. */
export const KEYS = {
  all: ['hub'] as const,
  prep: ['hub', 'prep'] as const,
  mentors: ['hub', 'mentors'] as const,
  mentor: (id: string) => ['hub', 'mentor', id] as const,
  mine: ['hub', 'requests', 'mine'] as const,
  incoming: ['hub', 'requests', 'incoming'] as const,
  student: (id: string) => ['hub', 'student', id] as const,
  slots: ['hub', 'slots'] as const,
  subjects: ['hub', 'subjects'] as const,
  resources: (q: string, subject: string) => ['hub', 'resources', q, subject] as const,
  profile: ['hub', 'profile'] as const,
  ranking: ['hub', 'ranking'] as const,
};

const qs = (params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};
const opts = (signal: AbortSignal) => ({ signal });

/** The server's own sentence for a failed mutation, never "Something went wrong". */
export const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Couldn't reach UniVerse. Try again.";

// Prep
export const getPrep = (signal: AbortSignal) => api('/api/hub/prep', hub.PrepView, opts(signal));
/** `Idempotency-Key`: a new UUID per click, so a retried request is counted once. */
export const increment = (topicId: string, key: string) =>
  api(`/api/hub/prep/${topicId}/increment`, hub.IncrementResponse, {
    method: 'POST',
    body: { delta: 1 },
    headers: { 'Idempotency-Key': key },
  });
export const trackTopics = (topicIds: string[]) =>
  api('/api/hub/prep/topics', hub.PrepView, { method: 'PUT', body: { topicIds } });

// Mentors and requests
export const getMentors = (signal: AbortSignal, cursor: string | null) =>
  api(`/api/hub/mentors${qs({ cursor })}`, hub.MentorList, opts(signal));
export const getMentor = (id: string, signal: AbortSignal) =>
  api(`/api/hub/mentors/${id}`, hub.MentorProfile, opts(signal));
export const getMine = (signal: AbortSignal) =>
  api('/api/hub/requests/mine?limit=100', hub.pages.requests, opts(signal));
export const getIncoming = (signal: AbortSignal, cursor: string | null) =>
  api(`/api/hub/requests/incoming${qs({ cursor })}`, hub.pages.requests, opts(signal));
export const createRequest = (body: z.input<typeof hub.CreateMentorshipRequest>) =>
  api('/api/hub/requests', hub.MentorshipRequest, { method: 'POST', body });
export const decide = (id: string, action: 'accept' | 'decline' | 'complete' | 'cancel') =>
  api(`/api/hub/requests/${id}/${action}`, hub.MentorshipRequest, { method: 'POST', body: {} });
export const getStudent = (id: string, signal: AbortSignal) =>
  api(`/api/hub/students/${id}`, hub.StudentCard, opts(signal));

// Slots (mentors and peer mentors)
export const getSlots = (signal: AbortSignal, cursor: string | null) =>
  api(`/api/hub/slots${qs({ cursor })}`, hub.pages.slots, opts(signal));
export const createSlot = (body: z.input<typeof hub.CreateSlotRequest>) =>
  api('/api/hub/slots', hub.MySlot, { method: 'POST', body });
export const deleteSlot = (id: string) => request(`/api/hub/slots/${id}`, { method: 'DELETE' });

// Resources
export const getSubjects = (signal: AbortSignal) =>
  api('/api/hub/subjects', z.array(hub.Subject), opts(signal));
export const getResources = (
  q: string,
  subject: string,
  cursor: string | null,
  signal: AbortSignal,
) =>
  api(
    `/api/hub/resources${qs({ q, subject: subject === 'All' ? null : subject, cursor })}`,
    hub.pages.resources,
    opts(signal),
  );
export const createResource = (body: z.input<typeof hub.CreateResourceRequest>) =>
  api('/api/hub/resources', hub.Resource, { method: 'POST', body });
export const deleteResource = (id: string) =>
  request(`/api/hub/resources/${id}`, { method: 'DELETE' });
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

/** The designed upload errors; anything else (quota, rate limit) is the server's sentence. */
export function uploadError(err: unknown) {
  if (err instanceof ApiRequestError && err.status === 413) return 'File is larger than 10 MB.';
  if (err instanceof ApiRequestError && err.status === 415) return 'Only PDF, PNG or JPEG files.';
  return message(err);
}

/** Multipart upload to `POST /api/files/hub.resource` (the server checks type and size). */
export async function uploadFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return api('/api/files/hub.resource', FileRecord, { method: 'POST', body: form });
}

// Profile and admin
export const getProfile = (signal: AbortSignal) => api('/api/hub/me', hub.HubProfile, opts(signal));
export const saveProfile = (body: z.input<typeof hub.UpdateProfileRequest>) =>
  api('/api/hub/me', hub.HubProfile, { method: 'PUT', body });
export const getRanking = (signal: AbortSignal, cursor: string | null) =>
  api(`/api/hub/admin/mentors${qs({ cursor })}`, hub.AdminMentorList, opts(signal));
