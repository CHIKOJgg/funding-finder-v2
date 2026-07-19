// Shared signed-request helpers for the live-portfolio (read-only) exchange
// adapters. Each function implements one exchange family's auth scheme and
// returns the parsed JSON body. All are best-effort per each exchange's public
// docs; failures are caught by the caller (per-exchange isolation), so a wrong
// signing scheme simply yields no positions for that account rather than
// breaking the portfolio aggregate.
import crypto from 'crypto';
import axios from 'axios';

export interface Creds {
  apiKey: string;
  secret: string;
  passphrase?: string;
}

function hmac(secret: string, msg: string): string {
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

function qs(params: Record<string, any>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return q.toString();
}

// ---- Binance-style (Aster): query-string HMAC, X-MBX-APIKEY header ----
export async function binanceReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const query = qs({ ...params, timestamp: String(Date.now()), recvWindow: '5000' });
  const sig = hmac(creds.secret, query);
  const url = `${base}${path}?${query}&signature=${sig}`;
  const headers = { 'X-MBX-APIKEY': creds.apiKey };
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, `${query}&signature=${sig}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, timeout: 10000 });
  return res.data;
}

// ---- ACCESS-* header style (Bitget, BloFin, ApeX) ----
export async function accessReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET',
  headerNames: { key: string; sign: string; ts: string; pass?: string } = {
    key: 'ACCESS-KEY', sign: 'ACCESS-SIGN', ts: 'ACCESS-TIMESTAMP', pass: 'ACCESS-PASSPHRASE',
  }
): Promise<any> {
  const ts = String(Date.now());
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(params);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(params);
  }
  const prehash = ts + method + urlPath + body;
  const sig = hmac(creds.secret, prehash);
  const headers: Record<string, string> = {
    [headerNames.key]: creds.apiKey,
    [headerNames.sign]: sig,
    [headerNames.ts]: ts,
  };
  if (creds.passphrase && headerNames.pass) headers[headerNames.pass] = creds.passphrase;
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...headers }, timeout: 10000 });
  return res.data;
}

// ---- BitMart X-BM-* style ----
export async function bitmartReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const ts = String(Date.now());
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(params);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(params);
  }
  const prehash = ts + method + urlPath + body;
  const sig = hmac(creds.secret, prehash);
  const headers = { 'X-BM-APIKEY': creds.apiKey, 'X-BM-TIMESTAMP': ts, 'X-BM-SIGN': sig };
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...headers }, timeout: 10000 });
  return res.data;
}

// ---- Phemex x-phemex-* style (best-effort) ----
export async function phemexReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const ts = String(Date.now());
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(params);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(params);
  }
  const prehash = ts + method + urlPath + body;
  const sig = hmac(creds.secret, prehash);
  const headers = {
    'x-phemex-access-key': creds.apiKey,
    'x-phemex-request-signature': sig,
    'x-phemex-request-time': ts,
  };
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...headers }, timeout: 10000 });
  return res.data;
}

// ---- CoinEx authorization header (access_id:tonce:token base64) ----
export async function coinexReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const tonce = String(Date.now() * 1000);
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(params);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(params);
  }
  const token = hmac(creds.secret, creds.apiKey + tonce + body);
  const auth = Buffer.from(`${creds.apiKey}:${tonce}:${token}`).toString('base64');
  const headers = { authorization: auth };
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...headers }, timeout: 10000 });
  return res.data;
}

// ---- Huobi/HTX Signature header (v2 scheme) ----
export async function huobiReq(
  base: string, host: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const baseParams: Record<string, any> = {
    ...params,
    AccessKeyId: creds.apiKey,
    SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2',
    Timestamp: timestamp,
  };
  const sorted = Object.keys(baseParams).sort();
  const query = sorted.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(baseParams[k])}`).join('&');
  const prehash = `${method}\n${host}\n${path}\n${query}`;
  const sig = crypto.createHmac('sha256', creds.secret).update(prehash).digest('base64');
  const url = `${base}${path}?${query}&Signature=${encodeURIComponent(sig)}`;
  const headers = { 'Content-Type': 'application/json' };
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, JSON.stringify(params), { headers, timeout: 10000 });
  return res.data;
}

// ---- WEEX / CoinW style (api_key + timestamp + sign query params) ----
export async function wexStyleReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const timestamp = String(Date.now());
  const baseParams: Record<string, any> = { ...params, api_key: creds.apiKey, timestamp };
  const sorted = Object.keys(baseParams).filter((k) => k !== 'sign').sort();
  const prehash = sorted.map((k) => `${k}=${baseParams[k]}`).join('&');
  const sign = hmac(creds.secret, prehash);
  baseParams.sign = sign;
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(baseParams);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(baseParams);
  }
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { timeout: 10000 })
    : await axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
  return res.data;
}

// ---- WOO X style (x-api-key header, HMAC-SHA256 over ts+method+path+body) ----
export async function wooReq(
  base: string, path: string, creds: Creds,
  params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  const timestamp = String(Date.now());
  let urlPath = path;
  let body = '';
  if (method === 'GET') {
    const s = qs(params);
    if (s) urlPath = `${path}?${s}`;
  } else {
    body = JSON.stringify(params);
  }
  const prehash = timestamp + method + urlPath + body;
  const sig = hmac(creds.secret, prehash);
  const headers = {
    'x-api-key': creds.apiKey,
    'x-api-signature': sig,
    'x-api-timestamp': timestamp,
    'Content-Type': 'application/json',
  };
  const url = `${base}${urlPath}`;
  const res = method === 'GET'
    ? await axios.get(url, { headers, timeout: 10000 })
    : await axios.post(url, body, { headers, timeout: 10000 });
  return res.data;
}
