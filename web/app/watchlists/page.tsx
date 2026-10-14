import { Watchlists } from '../../ui/watchlists';
import { RequireAuth } from '../../ui/require-auth';
export default function Page() {
  return (
    <RequireAuth>
      <Watchlists />
    </RequireAuth>
  );
}
