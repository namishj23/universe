/**
 * Rides route mocks from the prototype's sample data (UniVerse App.dc.html: STOPS, EDGES,
 * MY_ROUTE, MATCHES with its scoreOf(), the joins and the YOUR RIDES list), in the API's
 * response shapes and parsed with the contracts' schemas, so a drifting fixture fails here.
 *
 * Differences on purpose: the graph is the prototype's 10 illustrative stops (positions turned
 * into lat/lng) instead of the API's 22; drivers are first names only and the card's
 * "TE Comp" line is "driving" (the API has neither, see P7-004); seats read "n seats left"
 * (the API has no car total on a match); join-request lines have no score (not in the API).
 */
import type { Page } from '@playwright/test';
import { pageOf, rides } from '../../../packages/contracts/src/index.ts';
import type { U2Module } from './index.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(800 + n).padStart(12, '0')}`;
const at = (date: string, time: string) => `${date}T${time}:00+05:30`;
const FRI = '2026-10-30';

const STOPS = {
  BOR: { n: 'Borivali Stn', x: 90, y: 78 },
  DAH: { n: 'Dahisar', x: 40, y: 30 },
  KAN: { n: 'Kandivali', x: 150, y: 116 },
  MAL: { n: 'Malad', x: 212, y: 150 },
  GOR: { n: 'Goregaon', x: 276, y: 178 },
  JOG: { n: 'Jogeshwari', x: 340, y: 198 },
  AND: { n: 'Andheri Stn', x: 404, y: 216 },
  SPIT: { n: 'SPIT Gate', x: 470, y: 262 },
  LOK: { n: 'Lokhandwala', x: 336, y: 284 },
  POW: { n: 'Powai', x: 470, y: 120 },
};
type Code = keyof typeof STOPS;
const CODES = Object.keys(STOPS) as Code[];
const EDGES: [Code, Code][] = [
  ['DAH', 'BOR'],
  ['BOR', 'KAN'],
  ['KAN', 'MAL'],
  ['MAL', 'GOR'],
  ['GOR', 'JOG'],
  ['JOG', 'AND'],
  ['AND', 'SPIT'],
  ['GOR', 'LOK'],
  ['LOK', 'SPIT'],
  ['JOG', 'POW'],
  ['AND', 'POW'],
];
const stopId = (c: Code) => id(CODES.indexOf(c) + 1);
const ref = (c: Code) => ({ id: stopId(c), name: STOPS[c].n, shortName: c });

const graph = rides.GraphView.parse({
  nodes: CODES.map((c) => ({
    ...ref(c),
    area: c === 'SPIT' ? 'campus' : 'city',
    lat: 19.25 - STOPS[c].y / 1000,
    lng: 72.8 + STOPS[c].x / 1000 / Math.cos((19.1 * Math.PI) / 180),
    walkOnly: false,
  })),
  edges: EDGES.map(([a, b]) => {
    const d = Math.round(Math.hypot(STOPS[a].x - STOPS[b].x, STOPS[a].y - STOPS[b].y) * 20);
    return {
      nodeAId: stopId(a),
      nodeBId: stopId(b),
      distanceM: d,
      durationS: Math.round(d / 5.5),
      mode: 'road',
      estimated: false,
    };
  }),
});

// The prototype's own scoring (scoreOf), so the cards show its numbers.
const MY_ROUTE: Code[] = ['BOR', 'KAN', 'MAL', 'GOR', 'JOG', 'AND', 'SPIT'];
const pairs = (r: Code[]) => new Set(r.slice(1).map((c, i) => [r[i], c].sort().join('-')));
const MATCHES = [
  {
    n: 1,
    name: 'Diya',
    route: ['KAN', 'MAL', 'GOR', 'JOG', 'AND', 'SPIT'] as Code[],
    pickup: '08:11',
    diff: 1,
    detourM: 1200,
    seats: 1,
    joined: true,
  },
  {
    n: 2,
    name: 'Kabir',
    route: ['MAL', 'GOR', 'JOG', 'AND', 'SPIT'] as Code[],
    pickup: '08:17',
    diff: 7,
    detourM: 2100,
    seats: 2,
    joined: false,
  },
  {
    n: 3,
    name: 'Ishita',
    route: ['BOR', 'KAN', 'MAL', 'GOR', 'LOK', 'SPIT'] as Code[],
    pickup: '08:12',
    diff: 2,
    detourM: 400,
    seats: 2,
    joined: false,
  },
];
export const REQUEST_ID = id(100);
const offerMatches = rides.OfferMatches.parse({
  matches: MATCHES.map((m) => {
    const mine = pairs(MY_ROUTE);
    const theirs = pairs(m.route);
    const shared = [...theirs].filter((e) => mine.has(e)).length;
    const sim = shared / (mine.size + theirs.size - shared);
    const time = Math.max(0, 1 - m.diff / 10);
    return {
      offerId: id(200 + m.n),
      eligible: true,
      reason: null,
      reasonText: null,
      score: 0.7 * sim + 0.3 * time,
      routeSimilarity: sim,
      timeFit: time,
      weights: { routeSimilarity: 0.7, timeFit: 0.3 },
      minutesApart: m.diff,
      overlapRatio: shared / Math.min(mine.size, theirs.size),
      addedDetourMetres: m.detourM,
      pickupAt: at(FRI, m.pickup),
      departAt: at(FRI, m.pickup),
      seatsLeft: m.seats,
      driverFirstName: m.name,
      vehicleType: 'car',
      womenOnly: false,
      pickupNode: ref('BOR'),
      dropNode: ref('SPIT'),
      route: m.route.map((c) => STOPS[c].n),
      costSharePaise: 4121,
      soloFarePaise: 25434,
      savingsPaise: 21313,
      booking: m.joined ? { id: id(300 + m.n), status: 'accepted' } : null,
    };
  }),
  hidden: {
    total: 1,
    reasons: [{ reason: 'delay', count: 1, message: 'pickup 08:25 is outside ±10 min' }],
  },
});

const vehicle = {
  vehicleType: 'car',
  model: 'Maruti Swift',
  colour: null,
  plateNumber: 'MH 47 AB 1234',
};
const booking = (
  n: number,
  name: string,
  stop: Code,
  time: string,
  detourM: number,
  status: string,
  isYou = false,
) => ({
  id: id(400 + n),
  status,
  passengerFirstName: name,
  isYou,
  pickup: ref(stop),
  drop: ref('SPIT'),
  plannedPickupAt: at(FRI, time),
  addedDetourM: detourM,
  inVehicleM: 9000,
  costSharePaise: 4121,
  soloFarePaise: 25434,
  savingsPaise: 21313,
});
const offer = (o: {
  n: number;
  driver: string;
  isDriver: boolean;
  from: Code;
  time: string;
  bookings: ReturnType<typeof booking>[];
}) => ({
  id: id(200 + o.n),
  status: 'open',
  isDriver: o.isDriver,
  driverFirstName: o.driver,
  vehicle,
  origin: ref(o.from),
  destination: ref('SPIT'),
  departAt: at(FRI, o.time),
  seats: 3,
  peakOnboard: o.bookings.filter((b) => b.status === 'accepted').length,
  maxDetourM: 2000,
  maxDetourS: 360,
  costPerKmPaise: 700,
  autoAccept: false,
  womenOnly: false,
  baseDistanceM: 18000,
  planDistanceM: 19200,
  planDurationS: 3000,
  tripCostPaise: 13440,
  driverSharePaise: 9319,
  route: [STOPS[o.from].n, STOPS.SPIT.n],
  plan: [],
  bookings: o.bookings,
});
const Offers = pageOf(rides.OfferView);
const myBookings = Offers.parse({
  items: [
    offer({
      n: 1,
      driver: 'Diya',
      isDriver: false,
      from: 'KAN',
      time: '08:02',
      bookings: [booking(1, 'Aarav', 'BOR', '08:10', 1200, 'accepted', true)],
    }),
  ],
  nextCursor: null,
});
const fare = {
  distanceM: 18000,
  baseFarePaise: 2600,
  baseMetres: 1500,
  extraMetres: 16500,
  perKmPaise: 1749,
  distanceChargePaise: 28859,
  meterFarePaise: 31459,
  surgePercent: 0,
  surgeChargePaise: 0,
  totalFarePaise: 31459,
  members: [],
};
const myGroups = pageOf(rides.RidesGroupSummary).parse({
  items: [
    {
      id: id(500),
      status: 'forming',
      kind: 'auto',
      womenOnly: false,
      meetingPoint: null,
      transitMode: null,
      pickupName: 'SPIT Gate',
      dropName: 'Borivali Stn',
      pickupTime: at(FRI, '17:30'),
      seatsLeft: 2,
      members: [{ name: 'Aarav Mehta', initials: 'AM', dropName: 'Borivali Stn' }],
      fare,
      isMine: true,
      joinBlockedReason: null,
      paymentPending: false,
      isPast: false,
      leaveLockedReason: null,
    },
  ],
  nextCursor: null,
});
const carpool = rides.CarpoolDriver.parse({
  id: id(600),
  driverCode: 'CP-0412',
  status: 'approved',
  reviewNote: null,
  vehicle: {
    id: id(601),
    ...vehicle,
    seats: 3,
    insuranceExpiresAt: at('2027-06-30', '00:00'),
    pucExpiresAt: at('2027-03-31', '00:00'),
  },
  documentsVerified: true,
  documentsMessage: null,
  canOffer: true,
});
const myOffers = Offers.parse({
  items: [
    offer({
      n: 9,
      driver: 'Aarav',
      isDriver: true,
      from: 'MAL',
      time: '08:30',
      bookings: [
        booking(11, 'Kabir', 'GOR', '08:36', 600, 'requested'),
        booking(12, 'Ishita', 'MAL', '08:30', 0, 'accepted'),
        booking(13, 'Aarav', 'KAN', '08:24', 1800, 'requested'),
      ],
    }),
  ],
  nextCursor: null,
});

const tab = (label: string) => async (page: Page) => {
  await page.locator('aside button', { hasText: /Rides/ }).first().click();
  await page.getByRole('button', { name: label, exact: true }).click();
};
/** Undrawn tabs inside the designed viewport (recorded for U3). */
const masks = [
  'nav[aria-label="Rides sections"] a:has-text("Auto pools")',
  'nav[aria-label="Rides sections"] a:has-text("Savings")',
  'button:has-text("Mark departed")',
  'button:has-text("Cancel ride")',
];
const text = (t: string) => async (page: Page) => {
  await page.getByText(t).first().waitFor();
};

const mod: U2Module = {
  screens: [
    {
      name: 'rides-find',
      role: 'student',
      path: '/rides',
      prototype: tab('Find a ride'),
      ready: text('searching, no match yet'),
      masks,
    },
    {
      name: 'rides-matches',
      role: 'student',
      path: `/rides/matches?requestId=${REQUEST_ID}`,
      prototype: tab('Matches'),
      ready: text('MATCH SCORE'),
      masks,
    },
    {
      name: 'rides-offer',
      role: 'student',
      path: '/rides/offer',
      prototype: tab('Offer a ride'),
      ready: text('SEATS TAKEN'),
      masks,
    },
  ],
  respond: (_role, method, url) => {
    const p = url.pathname;
    if (!p.startsWith('/api/rides/') || method !== 'GET') return undefined;
    if (p === '/api/rides/graph') return { body: graph };
    if (p === '/api/rides/offers/matches') return { body: offerMatches };
    if (p === '/api/rides/bookings/mine') return { body: myBookings };
    if (p === '/api/rides/groups/mine') return { body: myGroups };
    if (p === '/api/rides/carpool/driver') return { body: carpool };
    if (p === '/api/rides/offers/mine') return { body: myOffers };
    return undefined;
  },
};
export default mod;
