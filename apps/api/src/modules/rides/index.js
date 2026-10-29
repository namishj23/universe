// Module B · Smart Campus Ride-Pooling (Person 1), ported from routepool2-react- @ 0c57429
// (see docs/DISCLOSURES.md). CommonJS: the platform reaches this code only through the factory
// below, and this code reaches the platform only through `platform` (one shared instance).
const core = require('./services/core');
const riders = require('./services/riders');
const drivers = require('./services/drivers');
const vehicles = require('./services/vehicles');
const admin = require('./services/admin');
const history = require('./services/history');
const routes = require('./routes');
const seed = require('./seed');

const WHO = {
  any: 'any signed-in rides user',
  rider: 'students, mentors and admins; not drivers',
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
        404: error('Not found (also for groups you are not in)'),
        409: error('Conflict (full group, taken ride, wrong state)'),
      },
    };
  }
  return paths;
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
  });
  const { router, table } = routes(platform, s);

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
    seed: () => seed(platform, c, s),
    filePurposes: [
      {
        id: 'rides.driver_document',
        mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        maxBytes: 5 * 1024 * 1024,
        // The driver who uploaded it, and admins. Anyone else gets 404.
        authorizeRead: (user, file) =>
          user.role === 'admin' || (user.role === 'driver' && user.id === file.ownerId),
      },
      {
        id: 'rides.inspection_photo',
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxBytes: 5 * 1024 * 1024,
        authorizeRead: (user) => user.role === 'admin',
      },
    ],
    openapi: openapi(table, platform.contracts.ApiErrorBody),
  };
};
