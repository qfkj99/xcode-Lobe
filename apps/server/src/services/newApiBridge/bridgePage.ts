import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

import { FLOW_COOKIE, bridgeConfig, bridgeCookieOptions, bridgeEnabled } from './security';

export const bridgePage = () => {
  if (!bridgeEnabled()) return new Response(null, { status: 404 });
  const challenge = randomBytes(32).toString('base64url');
  const scriptNonce = randomBytes(18).toString('base64url');
  const parentOrigin = bridgeConfig().publicURL.origin;
  const json = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const response = new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LobeHub</title></head><body><script nonce="${scriptNonce}">
const parentOrigin = ${json(parentOrigin)};
const challenge = ${json(challenge)};
let completing = false;
const send = (type) => parent.postMessage({type, challenge}, parentOrigin);
addEventListener('message', async (event) => {
  if (event.origin !== parentOrigin || event.source !== parent || event.data?.type !== 'newapi:launch' || completing) return;
  if (typeof event.data.ticket !== 'string') return;
  completing = true;
  try {
    const response = await fetch('/newapi/bridge/complete', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticket:event.data.ticket})});
    if (!response.ok) throw new Error('Login failed');
    send('newapi:authenticated');
    location.replace('/agent/inbox');
  } catch {
    send('newapi:error');
  }
});
send('newapi:ready');
</script></body></html>`,
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; frame-ancestors ${parentOrigin}`,
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
  response.cookies.set(FLOW_COOKIE, challenge, bridgeCookieOptions(120));
  return response;
};
