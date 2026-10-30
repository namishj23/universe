import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { dayMonthLabel } from '../../shell/format';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { Row, Table } from '../../shell/ui/Table';
import { BarChart, Card, CardLabel, KpiCard } from '../../shell/ui/Widgets';
import { keys, ridesApi } from './api';
import { km, rupees } from './format';
import s from './Rides.module.css';

/**
 * Savings (not drawn by the design; built from the Observatory KPI cards and chart): your
 * shared-ride totals from `GET /stats/me`. The API marks every figure `estimate: true`.
 */
export function Savings() {
  const navigate = useNavigate();
  const stats = useQuery({
    queryKey: keys.stats,
    queryFn: ({ signal }) => ridesApi.statsMe(signal),
  });
  if (stats.isPending) return <Loading what="your savings" />;
  if (stats.isError)
    return (
      <ErrorBox error={stats.error} what="your savings" onRetry={() => void stats.refetch()} />
    );
  const { totals, driver, weeks, busiestRoutes, estimate, assumptions } = stats.data;
  const est = estimate ? ' · estimate' : '';
  if (totals.sharedTrips === 0 && !driver?.completedOffers)
    return (
      <Empty
        title="No shared rides yet"
        body="Your savings appear after your first shared ride. Every figure is an estimate."
        action={{ label: 'Find a ride', onClick: () => void navigate('/rides') }}
      />
    );
  const max = Math.max(1, ...weeks.map((w) => w.savingsPaise));
  return (
    <>
      <div className={s.kpis}>
        <KpiCard
          label="SHARED RIDES"
          value={String(totals.sharedTrips)}
          note={`${totals.pooledTrips} auto pools, ${totals.carpoolTrips} carpools.`}
        />
        <KpiCard
          label={`SAVED${est.toUpperCase()}`}
          value={rupees(totals.savingsPaise)}
          note="Against riding alone in an auto."
        />
        <KpiCard
          label={`DISTANCE SHARED${est.toUpperCase()}`}
          value={(totals.sharedDistanceM / 1000).toFixed(1)}
          unit="km"
          note={`Average ${totals.averageOccupancy.toFixed(1)} people per ride.`}
        />
        {driver && (
          <KpiCard
            label={`COST RECOVERED${est.toUpperCase()}`}
            value={rupees(driver.costRecoveredPaise)}
            note={`${driver.seatsFilled} seats filled on ${driver.completedOffers} rides you drove.`}
          />
        )}
      </div>
      <Card pad={16} gap={12} data-mod="rides">
        <CardLabel meta={`₹ SAVED${est.toUpperCase()}`}>SAVED PER WEEK</CardLabel>
        <BarChart
          height={150}
          bars={weeks.map((w, i) => ({
            key: w.weekStart,
            value: rupees(w.savingsPaise),
            label: dayMonthLabel(w.weekStart),
            ratio: w.savingsPaise / max,
            highlight: i === weeks.length - 1,
          }))}
          summary={`Saved per week${est}: ${weeks
            .map((w) => `week of ${dayMonthLabel(w.weekStart)} ${rupees(w.savingsPaise)}`)
            .join(', ')}.`}
        />
      </Card>
      {busiestRoutes.length > 0 && (
        <Table
          label="Your busiest routes"
          columns="minmax(0,2fr) 90px"
          headers={['ROUTE', 'TRIPS']}
        >
          {busiestRoutes.map((r) => (
            <Row key={`${r.pickupName}-${r.dropName}`}>
              <span className={s.title}>
                {r.pickupName} → {r.dropName}
              </span>
              <span className={s.mono}>{r.trips}</span>
            </Row>
          ))}
        </Table>
      )}
      <span className={s.note}>
        All money and distance figures are estimates: the auto tariff (
        {rupees(assumptions.autoTariff.baseFarePaise)} for the first{' '}
        {km(assumptions.autoTariff.baseMetres)}, then {rupees(assumptions.autoTariff.perKmPaise)}{' '}
        per km) against your share of the shared fare. {assumptions.notes.join(' ')}
      </span>
    </>
  );
}
