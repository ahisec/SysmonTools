import { Database } from './database';
import { getSetting, setSetting } from './settings';

/**
 * GeoIP Enrichment — post-import IP-to-country resolution.
 *
 * Supports two providers:
 *   - ip-api.com (default) — free, no key needed, 45 req/min
 *   - ipstack.com — requires API key, 100 req/month on free tier
 *
 * Ported from Delphi ImportFormUnit.pas GetIPLocation() + IsPrivateIPv4Address().
 */

export type GeoProvider = 'ip-api' | 'ipstack';

// ─── Private IP detection ────────────────────────────────────────────────────
// Ported from Utilities.pas IsPrivateIPv4Address()

const PRIVATE_RANGES: [number, number][] = [
  [ipToNum('0.0.0.0'),       ipToNum('0.255.255.255')],       // 0.0.0.0/8
  [ipToNum('10.0.0.0'),      ipToNum('10.255.255.255')],      // 10.0.0.0/8
  [ipToNum('127.0.0.0'),     ipToNum('127.255.255.255')],     // 127.0.0.0/8
  [ipToNum('169.254.0.0'),   ipToNum('169.254.255.255')],     // 169.254.0.0/16
  [ipToNum('172.16.0.0'),    ipToNum('172.31.255.255')],      // 172.16.0.0/12
  [ipToNum('192.0.2.0'),     ipToNum('192.0.2.255')],         // 192.0.2.0/24
  [ipToNum('192.88.99.0'),   ipToNum('192.88.99.255')],       // 192.88.99.0/24
  [ipToNum('192.168.0.0'),   ipToNum('192.168.255.255')],     // 192.168.0.0/16
  [ipToNum('198.18.0.0'),    ipToNum('198.19.255.255')],      // 198.18.0.0/15
  [ipToNum('198.51.100.0'),  ipToNum('198.51.100.255')],      // 198.51.100.0/24
  [ipToNum('203.0.113.0'),   ipToNum('203.0.113.255')],       // 203.0.113.0/24
  [ipToNum('224.0.0.0'),     ipToNum('239.255.255.255')],     // 224.0.0.0/4 (multicast)
  [ipToNum('240.0.0.0'),     ipToNum('255.255.255.255')],     // 240.0.0.0/4 (reserved)
];

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':') || !ip.match(/^\d+\.\d+\.\d+\.\d+$/)) return true;
  const num = ipToNum(ip);
  return PRIVATE_RANGES.some(([lo, hi]) => num >= lo && num <= hi);
}

// ─── Settings accessors ──────────────────────────────────────────────────────

export function getApiKey(): string {
  return getSetting('ipstackApiKey');
}

export function setApiKey(key: string): void {
  setSetting('ipstackApiKey', key);
}

export function getProvider(): GeoProvider {
  return (getSetting('geoProvider') as GeoProvider) || 'ip-api';
}

export function setProvider(provider: GeoProvider): void {
  setSetting('geoProvider', provider);
}

// ─── Provider-specific lookup ────────────────────────────────────────────────

interface GeoResult {
  country: string;
  code: string;
}

async function lookupIpApi(ip: string): Promise<GeoResult | null> {
  // ip-api.com — free, no key, 45 req/min
  // http://ip-api.com/json/{ip}?fields=country,countryCode
  const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode`);
  const data = await resp.json();

  if (data.status === 'fail') {
    // "private range", "reserved range" etc. — skip silently
    return null;
  }
  if (data.country && data.countryCode) {
    return { country: data.country, code: data.countryCode };
  }
  return null;
}

async function lookupIpStack(ip: string, apiKey: string): Promise<GeoResult | null> {
  const resp = await fetch(`http://api.ipstack.com/${ip}?access_key=${apiKey}`);
  const data = await resp.json();

  if (data.error) {
    throw new Error(data.error.info || data.error.type || 'IPStack API error');
  }
  if (data.country_name && data.country_code) {
    return { country: data.country_name, code: data.country_code };
  }
  return null;
}

// ─── GeoIP Resolution ────────────────────────────────────────────────────────

interface GeoIpProgress {
  status: 'resolving' | 'done' | 'error';
  current: number;
  total: number;
  currentIp?: string;
  error?: string;
}

export async function resolveGeoIp(
  db: Database,
  provider: GeoProvider,
  apiKey: string,
  onProgress: (progress: GeoIpProgress) => void
): Promise<number> {
  // Collect unique IPs that need resolution
  const sourceRows = db.query(
    `SELECT DISTINCT SourceIp FROM NetworkConnectionDetected
     WHERE (SourceCountryCode = 'n/a' OR SourceCountryCode = '')
       AND SourceIp <> '0.0.0.0' AND SourceIp <> ''`
  ) as { SourceIp: string }[];

  const destRows = db.query(
    `SELECT DISTINCT DestinationIp FROM NetworkConnectionDetected
     WHERE (DestinationCountryCode = 'n/a' OR DestinationCountryCode = '')
       AND DestinationIp <> '0.0.0.0' AND DestinationIp <> ''`
  ) as { DestinationIp: string }[];

  // Deduplicate all IPs, skip private
  const allIps = new Set<string>();
  for (const row of sourceRows) {
    if (!isPrivateIp(row.SourceIp)) allIps.add(row.SourceIp);
  }
  for (const row of destRows) {
    if (!isPrivateIp(row.DestinationIp)) allIps.add(row.DestinationIp);
  }

  const ipList = Array.from(allIps);
  const total = ipList.length;

  if (total === 0) {
    onProgress({ status: 'done', current: 0, total: 0 });
    return 0;
  }

  // ip-api.com: 45 req/min → ~1.4s between requests, use 1.5s to be safe
  // ipstack: use 1.5s as well to emulate Delphi's natural delay
  const DELAY_MS = 1500;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const cache = new Map<string, GeoResult>();
  let resolved = 0;
  let aborted = false;

  for (let i = 0; i < ipList.length; i++) {
    if (aborted) break;

    const ip = ipList[i];
    onProgress({ status: 'resolving', current: i + 1, total, currentIp: ip });

    try {
      const result = provider === 'ip-api'
        ? await lookupIpApi(ip)
        : await lookupIpStack(ip, apiKey);

      if (result) {
        cache.set(ip, result);
        resolved++;
      }
    } catch (err: any) {
      onProgress({
        status: 'error',
        current: i + 1,
        total,
        error: err.message || `Error resolving ${ip}`,
      });
      aborted = true;
      break;
    }

    // Throttle between requests
    if (!aborted && i < ipList.length - 1) await delay(DELAY_MS);
  }

  // Batch-update the database
  if (cache.size > 0) {
    const statements: { sql: string; params: unknown[] }[] = [];

    for (const [ip, { country, code }] of cache) {
      statements.push({
        sql: `UPDATE NetworkConnectionDetected
              SET SourceCountry = ?, SourceCountryCode = ?
              WHERE SourceIp = ? AND (SourceCountryCode = 'n/a' OR SourceCountryCode = '')`,
        params: [country, code, ip],
      });
      statements.push({
        sql: `UPDATE NetworkConnectionDetected
              SET DestinationCountry = ?, DestinationCountryCode = ?
              WHERE DestinationIp = ? AND (DestinationCountryCode = 'n/a' OR DestinationCountryCode = '')`,
        params: [country, code, ip],
      });
    }

    db.executeMany(statements);
  }

  onProgress({ status: 'done', current: total, total });
  return resolved;
}
