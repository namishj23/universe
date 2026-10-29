// Module B · Smart Campus Ride-Pooling (Person 1), ported from routepool2-react- @ 0c57429
// (see docs/DISCLOSURES.md). CommonJS: the platform reaches this code only through the factory
// below, and this code reaches the platform only through `platform` (one shared instance).
const core = require('./services/core');
const riders = require('./services/riders');
const drivers = require('./services/drivers');
const vehicles = require('./services/vehicles');
const admin = require('./services/admin');
const history = require('./services/history');
const offers = require('./services/offers');
const stats = require('./services/stats');
const publicApi = require('./services/public');
const routes = require('./routes');
const seed = require('./seed');

const WHO = {
  any: 'any signed-in rides user',
  rider: 'students, mentors and admins; not drivers',
  carpool: 'students and mentors (offer routes also need an approved carpool driver record)',
  driver: 'drivers',
  admin: 'admins',
};

// OpenAPI paths from the same table the router is built from.
function openapi(table, ErrorBody) {
  const error = (description) => ({
    description,
    content: { 'application/json': { schema: ErrorBody } },
  });
  const paths = {};
  for (const [method, path, who, tag, summary, meta] of table) {
    const key = path.replace(/:(\w+)/g, '{$1}');
    paths[key] ??= {};
    paths[key][method] = {
      tags: [tag],
      summary,
      description: `Who may call: ${WHO[who]}.`,
      security: method === 'get' ? [{ session: [] }] : [{ session: [], csrf: [] }],
      ...((meta.params || meta.query) && {
        requestParams: {
          ...(meta.params && { path: meta.params }),
          ...(meta.query && { query: meta.query }),
        },
      }),
      ...(meta.body && { requestBody: { content: { 'application/json': { schema: meta.body } } } }),
      responses: {
        [String(meta.status ?? 200)]: {
          description: 'OK',
          content: { 'application/json': { schema: meta.response } },
        },
        400: error('Validation failed or bad input'),
        401: error('Not signed in'),
        403: error('Wrong role, CSRF, or suspended from rides'),
        404: error('Not found (also for groups and offers you are not in)'),
        409: error('Conflict (full group, taken ride, wrong state)'),
      },
    };
  }
  return paths;
}

// The dashboard's week strip: the user's own rides from publicApi.upcomingForUser.
const tripTitle = (r) =>
  r.to.area === 'campus' && r.from.area !== 'campus'
    ? 'Ride to SPIT'
    : r.from.area === 'campus' && r.to.area !== 'campus'
      ? 'Return ride'
      : `Ride to ${r.to.name}`;
const STATUS = {
  confirmed: { label: 'confirmed', tone: 'ok' },
  requested: { label: 'requested', tone: 'warn' },
  searching: { label: 'searching', tone: 'warn' },
  forming: { label: 'forming', tone: 'warn' },
};
function weekItem(r) {
  if (r.kind === 'offer')
    return {
      at: r.at.toISOString(),
      title: `Driving from ${r.from.name}`,
      status: { label: `${r.seats.taken} of ${r.seats.total} seats`, tone: 'ok' },
      confirmed: true,
      href: `/rides/offers/${r.id}`,
    };
  return {
    at: r.at.toISOString(),
    title: tripTitle(r),
    status: STATUS[r.status],
    confirmed: r.status === 'confirmed',
    href:
      r.kind === 'booking'
        ? `/rides/offers/${r.offerId}`
        : r.kind === 'group'
          ? `/rides/groups/${r.id}`
          : `/rides/matches?requestId=${r.id}`,
  };
}

// Which of `ids` a rides table still references in any of `fields` (one query).
async function referenced(model, ids, fields) {
  const rows = await model.findMany({
    where: { OR: fields.map((f) => ({ [f]: { in: [...ids] } })) },
    select: Object.fromEntries(fields.map((f) => [f, true])),
  });
  const wanted = new Set(ids);
  return new Set(rows.flatMap((r) => fields.map((f) => r[f])).filter((id) => wanted.has(id)));
}

module.exports = (platform) => {
  const c = core(platform);
  const s = {};
  Object.assign(s, {
    riders: riders(c, s),
    drivers: drivers(c, s),
    vehicles: vehicles(c, s),
    admin: admin(c, s),
    history: history(c, s),
    offers: offers(c, s),
    stats: stats(c, s),
  });
  const { router, table } = routes(platform, s);
  const api = publicApi(c);

  return {
    id: 'rides',
    label: 'Rides',
    order: 20,
    roles: ['student', 'mentor', 'driver', 'admin'],
    router,
    dashboardSummary: (user) =>
      user.role === 'driver'
        ? s.drivers.dashboardSummary(user.id)
        : s.history.riderSummary(user.id),
    weekItems: async (user, range) =>
      (await api.upcomingForUser({ actor: user, ...range })).slice(0, 50).map(weekItem),
    publicApi: api,
    seed: () => seed(platform, c, s),
    filePurposes: [
      {
        id: 'rides.driver_document',
        mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        maxBytes: 5 * 1024 * 1024,
        // The driver who uploaded it, and admins. Anyone else gets 404.
        // The driver (auto or carpool) who uploaded it, and admins. Anyone else gets 404.
        authorizeRead: (user, file) => user.role === 'admin' || user.id === file.ownerId,
        // Attached to a driver document: can't be deleted, never swept.
        inUse: (ids) => referenced(platform.prisma.ridesDriverDocument, ids, ['fileId']),
      },
      {
        id: 'rides.inspection_photo',
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxBytes: 5 * 1024 * 1024,
        authorizeRead: (user) => user.role === 'admin',
        inUse: (ids) =>
          referenced(platform.prisma.ridesVehicleInspection, ids, [
            'tyresFileId',
            'lightsFileId',
            'seatsFileId',
            'meterFileId',
          ]),
      },
    ],
    openapi: openapi(table, platform.contracts.ApiErrorBody),
  };
};
