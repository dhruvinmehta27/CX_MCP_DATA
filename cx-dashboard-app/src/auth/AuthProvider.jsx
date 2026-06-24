import { useEffect, useState } from 'react';
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { msalConfig, tokenRequest } from './msalConfig';
import { setTokenGetter } from '../api/client';

export const msalInstance = new PublicClientApplication(msalConfig);

/** Acquire a fresh access token; redirect to login when interaction is needed. */
export async function acquireToken() {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    await msalInstance.acquireTokenRedirect(tokenRequest);
    return null;
  }
  try {
    const result = await msalInstance.acquireTokenSilent({
      ...tokenRequest,
      account: accounts[0],
    });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect(tokenRequest);
      return null;
    }
    throw err;
  }
}

function AuthGate({ children }) {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  useEffect(() => {
    setTokenGetter(acquireToken);
  }, []);

  useEffect(() => {
    if (!isAuthenticated && inProgress === 'none') {
      instance.loginRedirect(tokenRequest);
    }
  }, [isAuthenticated, inProgress, instance]);

  if (!isAuthenticated) {
    return (
      <div className="auth-splash">
        <div className="auth-splash-card">
          <div className="auth-splash-logo">TSS</div>
          <h1>Dashboard &amp; Analytics</h1>
          <p>Signing you in with Microsoft…</p>
          <div className="auth-spinner" />
        </div>
      </div>
    );
  }
  return children;
}

export default function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    msalInstance
      .initialize()
      .then(() => msalInstance.handleRedirectPromise())
      .then((result) => {
        if (result?.account) msalInstance.setActiveAccount(result.account);
        setReady(true);
      })
      .catch((err) => {
        console.error('MSAL init failed', err);
        setReady(true);
      });
  }, []);

  if (!ready) return null;

  return (
    <MsalProvider instance={msalInstance}>
      <AuthGate>{children}</AuthGate>
    </MsalProvider>
  );
}
