// Google sign-in. The frontend renders the official GIS button, which hands us
// an ID token (JWT); we verify signature + audience with Google's own library
// and return the claims we care about. No client secret involved — the ID-token
// flow only needs the public client id, so it lives in env like other config.

const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const googleEnabled = () => !!client;

// Returns { sub, email, name } or throws with a guest-safe message.
async function verifyGoogleCredential(credential) {
  if (!client) throw new Error('Google sign-in isn’t configured.');
  if (typeof credential !== 'string' || !credential) throw new Error('Missing Google credential.');
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new Error('Google sign-in could not be verified — please try again.');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Your Google account has no verified email address.');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || '' };
}

module.exports = { googleEnabled, verifyGoogleCredential, GOOGLE_CLIENT_ID };
