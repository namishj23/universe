// Read-only functions other modules call through `platform.modules.get('rides')` (contracts
// `rides/public.ts`; the platform validates input and output and limits each call to 500 ms).
// Only stops and the actor's own rides ever leave this module.
module.exports = function publicApi(c) {
  const { prisma } = c;

  const toStop = (g, id) => {
    const n = g.byId.get(id);
    return n
      ? { id: n.id, name: n.name, shortName: n.shortName, area: n.area, drivable: !g.walkOnly(id) }
      : null;
  };

  async function findStop({ stopId }) {
    return toStop(await c.loadGraph(), stopId);
  }

  // Exact name, short name or id first, then names starting with the text, then containing it.
  async function searchStops({ q }) {
    const g = await c.loadGraph();
    const text = q.toLowerCase();
    const rank = (n) => {
      const fields = [n.name, n.shortName, n.id].map((f) => f.toLowerCase());
      if (fields.includes(text)) return 0;
      if (fields.some((f) => f.startsWith(text))) return 1;
      if (
        fields.some((f) => f.includes(text)) ||
        n.aliases.some((a) => a.toLowerCase().includes(text))
      )
        return 2;
      return null;
    };
    return g.nodes
      .map((n) => ({ n, r: rank(n) }))
      .filter((x) => x.r !== null)
      .sort((a, b) => a.r - b.r || a.n.name.localeCompare(b.n.name))
      .slice(0, 10)
      .map((x) => toStop(g, x.n.id));
  }

  /**
   * The actor's own rides in [from, to): seats in other people's cars, offers they drive,
   * pooled autos they are in and requests still searching (one query per kind, all indexed).
   */
  async function upcomingForUser({ actor, from, to }) {
    const userId = actor.id;
    const window = { gte: from, lt: to };
    const [g, bookings, offers, groups, requests] = await Promise.all([
      c.loadGraph(),
      prisma.ridesOfferBooking.findMany({
        where: {
          passengerId: userId,
          status: { in: ['requested', 'accepted'] },
          plannedPickupAt: window,
          offer: { status: { in: ['open', 'full', 'departed'] } },
        },
        select: {
          id: true,
          offerId: true,
          status: true,
          plannedPickupAt: true,
          pickupNodeId: true,
          dropNodeId: true,
          offer: { select: { driver: { select: { user: { select: { name: true } } } } } },
        },
        take: 50,
      }),
      prisma.ridesOffer.findMany({
        where: { driverId: userId, status: { in: ['open', 'full', 'departed'] }, departAt: window },
        select: {
          id: true,
          departAt: true,
          originNodeId: true,
          destNodeId: true,
          seats: true,
          peakOnboard: true,
        },
        take: 50,
      }),
      prisma.ridesGroupMember.findMany({
        where: {
          userId,
          group: { status: { in: ['forming', 'confirmed'] }, pickupAt: window },
        },
        select: {
          dropNodeId: true,
          group: { select: { id: true, status: true, pickupAt: true, pickupNodeId: true } },
        },
        take: 50,
      }),
      // Still searching: open, and no seat requested or accepted for it yet.
      prisma.ridesRequest.findMany({
        where: {
          userId,
          status: 'open',
          pickupAt: window,
          bookings: { none: { status: { in: ['requested', 'accepted'] } } },
        },
        select: { id: true, pickupAt: true, pickupNodeId: true, dropNodeId: true },
        take: 50,
      }),
    ]);
    const stop = (id) =>
      toStop(g, id) ?? { id, name: 'Unknown stop', shortName: '?', area: 'city', drivable: false };
    const items = [
      ...bookings.map((b) => ({
        kind: 'booking',
        id: b.id,
        offerId: b.offerId,
        at: b.plannedPickupAt,
        from: stop(b.pickupNodeId),
        to: stop(b.dropNodeId),
        status: b.status === 'accepted' ? 'confirmed' : 'requested',
        seats: null,
        driverName: b.offer.driver.user.name,
      })),
      ...offers.map((o) => ({
        kind: 'offer',
        id: o.id,
        offerId: o.id,
        at: o.departAt,
        from: stop(o.originNodeId),
        to: stop(o.destNodeId),
        status: 'driving',
        seats: { taken: o.peakOnboard, total: o.seats },
        driverName: null,
      })),
      ...groups.map((m) => ({
        kind: 'group',
        id: m.group.id,
        offerId: null,
        at: m.group.pickupAt,
        from: stop(m.group.pickupNodeId),
        to: stop(m.dropNodeId),
        status: m.group.status === 'confirmed' ? 'confirmed' : 'forming',
        seats: null,
        driverName: null,
      })),
      ...requests.map((r) => ({
        kind: 'request',
        id: r.id,
        offerId: null,
        at: r.pickupAt,
        from: stop(r.pickupNodeId),
        to: stop(r.dropNodeId),
        status: 'searching',
        seats: null,
        driverName: null,
      })),
    ];
    return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, 100);
  }

  return { findStop, searchStops, upcomingForUser };
};
