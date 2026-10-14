import { PasswordForm } from '../../../ui/password-form';
import { RequireAuth } from '../../../ui/require-auth';
export default function Page() {
  return (
    <RequireAuth>
      <PasswordForm />
    </RequireAuth>
  );
}
