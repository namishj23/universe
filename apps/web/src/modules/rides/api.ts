import type { z } from 'zod';
import { rides as R } from '@universe/contracts';
import { api, ApiRequestError } from '../../platform/api';

/**
 * Every /api/rides call the web makes, typed by the contracts. A response-shape change
 * (P8's "Contract changes for U2") is one edit here. Query keys all start with 'rides'.
 */
const B = '/api/rides';
type Signal = AbortSignal | undefined;
const opt = (signal: Signal) => (signal ? { signal } : {});
const qs = (params: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== null && v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
const post = <S extends z.ZodType>(path: string, schema: S, body: unknown = {}) =>
  api(`${B}${path}`, schema, { method: 'POST', body });

export type Graph = z.infer<typeof R.GraphView>;
export type Stop = Graph['nodes'][number];
export type RideRequest = z.infer<typeof R.RideRequestCreated>;
export type OfferMatch = z.infer<typeof R.OfferMatch>;
export type OfferMatches = z.infer<typeof R.OfferMatches>;
export type Offer = z.infer<typeof R.OfferView>;
export type Booking = Offer['bookings'][number];
export type CarpoolDriver = z.infer<typeof R.CarpoolDriver>;
export type GroupSummary = z.infer<typeof R.RidesGroupSummary>;
export type GroupDetail = z.infer<typeof R.RidesGroupDetail>;
export type PoolMatch = z.infer<typeof R.RidesMatch>;
export type ChatMessage = z.infer<typeof R.RidesChatMessage>;
export type DriverCard = z.infer<typeof R.RidesDriverCard>;
export type StatsReport = z.infer<typeof R.RidesStatsReport>;
export type ComplaintTag = z.infer<typeof R.ComplaintTag>;
export const COMPLAINT_TAGS = R.ComplaintTag.options;
export const CHAT_MAX = 1000;

const Offers = R.offerPages.offers;
const Ack = R.Ack;

export const keys = {
  all: ['rides'] as const,
  graph: ['rides', 'graph'] as const,
  me: ['rides', 'me'] as const,
  request: (id: string) => ['rides', 'request', id] as const,
  offerMatches: (requestId: string) => ['rides', 'matches', 'offers', requestId] as const,
  poolMatches: (requestId: string) => ['rides', 'matches', 'pools', requestId] as const,
  offers: ['rides', 'offers'] as const,
  offer: (id: string) => ['rides', 'offers', id] as const,
  carpool: ['rides', 'carpool'] as const,
  bookings: ['rides', 'bookings'] as const,
  groups: ['rides', 'groups'] as const,
  group: (id: string) => ['rides', 'groups', id] as const,
  driverCard: (id: string) => ['rides', 'groups', id, 'driver'] as const,
  chat: (id: string) => ['rides', 'groups', id, 'chat'] as const,
  stats: ['rides', 'stats'] as const,
};

/** A 404 from the API (e.g. "You have not applied to drive yet."). */
export const isNotFound = (err: unknown) => err instanceof ApiRequestError && err.status === 404;

export const ridesApi = {
  graph: (signal?: Signal) => api(`${B}/graph`, R.GraphView, opt(signal)),
  me: (signal?: Signal) => api(`${B}/me`, R.RidesProfile, opt(signal)),

  // Find a ride and carpool matches.
  createRequest: (body: z.input<typeof R.CreateRideRequest>) =>
    post('/requests', R.RideRequestCreated, body),
  offerMatches: (requestId: string, signal?: Signal) =>
    api(`${B}/offers/matches${qs({ requestId })}`, R.OfferMatches, opt(signal)),
  bookSeat: (offerId: string, requestId: string) =>
    post(`/offers/${offerId}/bookings`, R.OfferView, { requestId }),
  cancelBooking: (bookingId: string) => post(`/bookings/${bookingId}/cancel`, Ack),
  myBookings: (signal?: Signal) =>
    api(`${B}/bookings/mine${qs({ limit: 20 })}`, Offers, opt(signal)),
  offer: (id: string, signal?: Signal) => api(`${B}/offers/${id}`, R.OfferView, opt(signal)),

  // Offer a ride (carpool drivers: students and mentors).
  carpool: (signal?: Signal) => api(`${B}/carpool/driver`, R.CarpoolDriver, opt(signal)),
  myOffers: (signal?: Signal) => api(`${B}/offers/mine${qs({ limit: 20 })}`, Offers, opt(signal)),
  createOffer: (body: z.input<typeof R.CreateOfferRequest>) => post('/offers', R.OfferView, body),
  updateOffer: (id: string, body: z.input<typeof R.UpdateOfferRequest>) =>
    api(`${B}/offers/${id}`, R.OfferView, { method: 'PATCH', body }),
  offerStep: (id: string, step: 'cancel' | 'depart' | 'complete') =>
    post(`/offers/${id}/${step}`, R.OfferView),
  decideBooking: (bookingId: string, decision: 'accept' | 'decline') =>
    post(`/bookings/${bookingId}/${decision}`, R.OfferView),

  // Pooled autos.
  poolMatches: (rideRequestId: string, signal?: Signal) =>
    api(`${B}/matches${qs({ rideRequestId })}`, R.RidesMatches, opt(signal)),
  availableGroups: (cursor: string | null, signal?: Signal) =>
    api(`${B}/groups/available${qs({ cursor, limit: 20 })}`, R.pages.groups, opt(signal)),
  myGroups: (signal?: Signal) =>
    api(`${B}/groups/mine${qs({ limit: 20 })}`, R.pages.groups, opt(signal)),
  group: (id: string, signal?: Signal) => api(`${B}/groups/${id}`, R.RidesGroupDetail, opt(signal)),
  joinMatch: (rideRequestId: string, memberRideRequestIds: string[]) =>
    post('/groups/join', R.RidesGroupDetail, { rideRequestId, memberRideRequestIds }),
  joinGroup: (id: string) => post(`/groups/${id}/join`, R.RidesGroupDetail),
  leaveGroup: (id: string) => post(`/groups/${id}/leave`, Ack),
  /**
   * The group's driver, read only. Today (before P8, P7-018) this GET also assigns one; after
   * P8 it only reads, and `assignDriver` becomes the POST.
   */
  driverCard: (id: string, signal?: Signal) =>
    api(`${B}/groups/${id}/driver`, R.RidesDriverCard, opt(signal)),
  // P8 (P7-018): change to post(`/groups/${id}/driver`, R.RidesDriverCard).
  assignDriver: (id: string) => api(`${B}/groups/${id}/driver`, R.RidesDriverCard),
  chat: (id: string, cursor: string | null, signal?: Signal) =>
    api(`${B}/groups/${id}/chat${qs({ cursor, limit: 30 })}`, R.pages.chat, opt(signal)),
  sendChat: (id: string, message: string) =>
    post(`/groups/${id}/chat`, R.RidesChatMessage, { message }),
  feedback: (id: string, body: z.input<typeof R.FeedbackRequest>) =>
    post(`/groups/${id}/feedback`, Ack, body),

  statsMe: (signal?: Signal) => api(`${B}/stats/me`, R.RidesStatsReport, opt(signal)),
};
