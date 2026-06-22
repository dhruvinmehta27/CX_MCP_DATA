import { useCallback, useEffect, useState } from 'react';
import { getAccessCheck } from '../api/analytics';
import useAuth from './useAuth';
import Icon from '../components/ui/Icon';

/**
 * Sits inside the authenticated shell. Sign-in stays open to any Azure AD user,
 * but if that user has no C4C access (the OBO probe fails), show one clear
 * "no access" screen instead of a dashboard full of empty/error widgets.
 */
export default function AccessGate({ children }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState('checking'); // checking | ok | denied

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await getAccessCheck();
      setStatus(res?.ok ? 'ok' : 'denied');
    } catch {
      // network/server error — treat as no access, the screen offers a retry
      setStatus('denied');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === 'checking') {
    return (
      <div className="auth-splash">
        <div className="auth-splash-card">
          <div className="auth-splash-logo">TSS</div>
          <h1>Dashboard &amp; Analytics</h1>
          <p>Checking your access…</p>
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="auth-splash">
        <div className="auth-splash-card access-denied">
          <div className="access-denied-icon">
            <Icon name="alert-triangle" size={30} />
          </div>
          <h1>No access to this dashboard</h1>
          <p>
            You are signed in as <strong>{user?.username || user?.name || 'your account'}</strong>, but
            your account does not have access to the TSS C4C data this dashboard needs.
          </p>
          <p className="access-denied-hint">
            If you believe this is a mistake, ask your administrator to grant your C4C user the
            required sales authorizations, then retry.
          </p>
          <div className="access-denied-actions">
            <button className="btn" onClick={check}>
              <Icon name="refresh" size={15} />
              Retry
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              <Icon name="logout" size={15} />
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
