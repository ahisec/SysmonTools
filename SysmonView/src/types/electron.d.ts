/** Type definitions for the API exposed by electron/preload.ts */

interface ImportProgress {
  eventsProcessed: number;
  currentFile: string;
  status: 'importing' | 'done' | 'error';
  error?: string;
}

interface SysmonDbApi {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
  executeMany(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  hasData(): Promise<boolean>;
  clearAll(): Promise<void>;
  openFile(filePath: string): Promise<boolean>;
  getPath(): Promise<string | null>;
}

interface SysmonDialogApi {
  openXmlFiles(): Promise<string[]>;
  openDatabase(): Promise<string | null>;
}

interface SysmonImportApi {
  xmlFiles(filePaths: string[]): Promise<number>;
  onProgress(callback: (progress: ImportProgress) => void): void;
  removeProgressListener(): void;
}

interface GeoIpProgress {
  status: 'resolving' | 'done' | 'error';
  current: number;
  total: number;
  currentIp?: string;
  error?: string;
}

type GeoProvider = 'ip-api' | 'ipstack';

interface SysmonGeoIpApi {
  getKey(): Promise<string>;
  setKey(key: string): Promise<void>;
  getProvider(): Promise<GeoProvider>;
  setProvider(provider: GeoProvider): Promise<void>;
  resolve(provider: GeoProvider, apiKey: string): Promise<number>;
  onProgress(callback: (progress: GeoIpProgress) => void): void;
  removeProgressListener(): void;
}

interface SysmonSettingsApi {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}

interface VtResult {
  found: boolean;
  positives: number;
  total: number;
  scanDate: string;
  permalink: string;
  verboseMsg: string;
}

interface VtIpResult {
  found: boolean;
  detectedUrls: number;
  detectedSamples: number;
  country: string;
  asOwner: string;
  verboseMsg: string;
}

interface SysmonVtApi {
  getKey(): Promise<string>;
  setKey(key: string): Promise<void>;
  lookup(apiKey: string, hash: string): Promise<VtResult>;
  lookupIp(apiKey: string, ip: string): Promise<VtIpResult>;
}

interface SysmonShellApi {
  openExternal(url: string): Promise<void>;
}

interface SysmonMenuApi {
  on(channel: string, callback: () => void): void;
  removeAll(channel: string): void;
}

interface SysmonApi {
  db: SysmonDbApi;
  dialog: SysmonDialogApi;
  import: SysmonImportApi;
  settings: SysmonSettingsApi;
  geoip: SysmonGeoIpApi;
  vt: SysmonVtApi;
  shell: SysmonShellApi;
  menu: SysmonMenuApi;
}

declare global {
  interface Window {
    sysmonApi: SysmonApi;
  }
}

export {};
