/**
 * Auth middleware — Bearer token present = authenticated.
 * The Azure AD token is NOT verified here: full validation happens in the
 * BTP Destination Service (x_user_token.jwks_uri against Azure AD JWKS).
 * We only decode the payload to derive the per-user cache key (upn claim).
 *
 * Exception: POST /api/dashboard/inline may authenticate with X-API-Key
 * instead (Copilot Studio has no user token).
 */

export function decodeJwtPayload(jwt) {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  // API-key alternative for the Copilot Studio inline endpoints only
  // (/dashboard/inline and /dashboard/inline-image)
  if (req.path.startsWith('/dashboard/inline') || req.originalUrl.startsWith('/api/dashboard/inline')) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && process.env.INLINE_API_KEY && apiKey === process.env.INLINE_API_KEY) {
      req.apiKeyAuth = true;
      req.userEmail = 'copilot-studio';
      return next();
    }
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }
  const token = authHeader.slice(7).trim();
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return res.status(401).json({ error: 'Malformed Bearer token' });
  }

  req.userJwt = token;
  // Azure AD access tokens carry upn (not email)
  req.userEmail = payload.upn || payload.preferred_username || payload.email || payload.sub || 'unknown';
  next();
}
