import { ComingSoon } from '../../shell/pages/ModulePage';

/** hub's screens arrive in U2; the folder already gets its own lazily loaded chunk. */
export default function Page() {
  return <ComingSoon id="hub" />;
}
