import { useCallback, useEffect, useState } from 'react';
import { getAccessCheck } from '../api/analytics';
import useAuth from './useAuth';
import Icon from '../components/ui/Icon';

/**
 * Sits inside the authenticated shell. Sign-in stays open to any Azure AD user,
 * but if that user has no C4C access (the OBO probe fails), show one clear
 * "no access" screen instead of a dashboard full of empty/error widgets.
 *
 * Distinguishes two failure modes so they can actually be traced:
 *   - 'access'  — the API responded but the C4C OBO probe was denied (message
 *                 carries the exact reason: OBO mapping vs authorization).
 *   - 'network' — the API itself couldn't be reached (proxy / VPN / firewall /
 *                 server down) — common on restrictive corporate networks.
 */
export default function AccessGate({ children }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState('checking'); // checking | ok | denied
  const [detail, setDetail] = useState(null); // { kind: 'access'|'network', message }

  const check = useCallback(async () => {
    setStatus('checking');
    setDetail(null);
    try {
      const res = await getAccessCheck();
      if (res?.ok) {
        setStatus('ok');
        return;
      }
      setStatus('denied');
      setDetail({ kind: 'access', message: res?.message || '' });
    } catch (err) {
      // Couldn't even reach the API (network / proxy / VPN / server down) —
      // distinct from "reached C4C and was denied".
      setStatus('denied');
      setDetail({ kind: 'network', message: err?.message || 'Could not reach the dashboard service.' });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === 'checking') {
    return (
      <div className="auth-splash">
        <div className="auth-splash-card">
          <img src="/Company_Logo.png" alt="Trelleborg" className="auth-splash-logo-img" />
          <h1>CX AI Intelligence</h1>
          <p>Checking your access…</p>
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    const isNetwork = detail?.kind === 'network';
    return (
      <div className="auth-splash">
        <div className="auth-splash-card access-denied">
          <div className="access-denied-icon">
            <Icon name="alert-triangle" size={30} />
          </div>
          <h1>{isNetwork ? "Can't reach the dashboard" : 'No access to this dashboard'}</h1>
          <p>
            You are signed in as <strong>{user?.username || user?.name || 'your account'}</strong>
            {isNetwork
              ? ', but the dashboard service could not be reached. This is usually a network, VPN, or corporate-proxy issue rather than an access problem.'
              : ', but your account does not have access to the TSS C4C data this dashboard needs.'}
          </p>
          <p className="access-denied-hint">
            {isNetwork
              ? 'Check your internet / VPN connection and retry. If it only fails on one network, your IT may be blocking the app or Microsoft sign-in.'
              : 'If you believe this is a mistake, ask your administrator to grant your C4C user the required sales authorizations, then retry.'}
          </p>
          {detail?.message && (
            <details style={{ marginBottom: 18, maxWidth: 460, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
                Technical details (share with your administrator)
              </summary>
              <code
                style={{
                  display: 'block',
                  marginTop: 8,
                  padding: '8px 10px',
                  background: 'var(--bg)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {detail.message}
              </code>
            </details>
          )}
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
