import { getSetting, setSetting } from './settings';

/**
 * VirusTotal on-demand lookups for hashes and IP addresses.
 *
 * Ported from Delphi ProcessCreateUnit.pas (hashes) and VirusTotalIPReport.pas (IPs).
 *
 * Hash API: GET https://www.virustotal.com/vtapi/v2/file/report?apikey={KEY}&resource={HASH}
 * IP API:   GET https://www.virustotal.com/vtapi/v2/ip-address/report?apikey={KEY}&ip={IP}
 */

export interface VtResult {
  found: boolean;
  positives: number;
  total: number;
  scanDate: string;
  permalink: string;
  verboseMsg: string;
}

export interface VtIpResult {
  found: boolean;
  detectedUrls: number;
  detectedSamples: number;
  country: string;
  asOwner: string;
  verboseMsg: string;
}

export function getVtApiKey(): string {
  return getSetting('virusTotalApiKey');
}

export function setVtApiKey(key: string): void {
  setSetting('virusTotalApiKey', key);
}

export async function lookupHash(apiKey: string, hash: string): Promise<VtResult> {
  const url = `https://www.virustotal.com/vtapi/v2/file/report?apikey=${encodeURIComponent(apiKey)}&resource=${encodeURIComponent(hash)}`;

  const resp = await fetch(url);

  if (resp.status === 204) {
    throw new Error('VirusTotal rate limit exceeded. Free API allows 4 requests/minute. Please wait and try again.');
  }

  if (!resp.ok) {
    throw new Error(`VirusTotal API error: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (data.response_code === 0) {
    return {
      found: false,
      positives: 0,
      total: 0,
      scanDate: '',
      permalink: '',
      verboseMsg: data.verbose_msg || 'Hash not found in VirusTotal database',
    };
  }

  return {
    found: true,
    positives: data.positives || 0,
    total: data.total || 0,
    scanDate: data.scan_date || '',
    permalink: data.permalink || '',
    verboseMsg: data.verbose_msg || '',
  };
}

export async function lookupIp(apiKey: string, ip: string): Promise<VtIpResult> {
  const url = `https://www.virustotal.com/vtapi/v2/ip-address/report?apikey=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(ip)}`;

  const resp = await fetch(url);

  if (resp.status === 204) {
    throw new Error('VirusTotal rate limit exceeded. Free API allows 4 requests/minute. Please wait and try again.');
  }

  if (!resp.ok) {
    throw new Error(`VirusTotal API error: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (data.response_code === 0) {
    return {
      found: false,
      detectedUrls: 0,
      detectedSamples: 0,
      country: '',
      asOwner: '',
      verboseMsg: data.verbose_msg || 'IP not found in VirusTotal database',
    };
  }

  const detectedUrls = Array.isArray(data.detected_urls) ? data.detected_urls.length : 0;
  const detectedSamples = Array.isArray(data.detected_communicating_samples)
    ? data.detected_communicating_samples.length : 0;

  return {
    found: true,
    detectedUrls,
    detectedSamples,
    country: data.country || '',
    asOwner: data.as_owner || '',
    verboseMsg: data.verbose_msg || '',
  };
}
