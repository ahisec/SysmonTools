import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// sql.js needs to locate its WASM file. In ESM context, the auto-locator may
// fail. We resolve the path explicitly using require.resolve.
let sqlWasmPath: string;
try {
  // Works in CJS context
  sqlWasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
} catch {
  // ESM context — use createRequire
  const req = createRequire(import.meta.url);
  sqlWasmPath = req.resolve('sql.js/dist/sql-wasm.wasm');
}

/**
 * SQLite database wrapper for Sysmon View.
 *
 * Schema is ported directly from the Delphi application's
 * FDQueryBuildDatabaseStructure in DataUnit.dfm.
 * All 28 tables are preserved with identical column names and types.
 *
 * Uses sql.js (WebAssembly SQLite) — no native compilation required.
 */
export class Database {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  getPath(): string {
    return this.dbPath;
  }

  /** Open the database and create tables if they don't exist */
  async initialize(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: () => sqlWasmPath,
    });

    const isNewDb = !fs.existsSync(this.dbPath);
    if (!isNewDb) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();
    // Only save for new databases — don't overwrite existing files during init
    if (isNewDb) {
      this.save();
    }
  }

  /** Persist database to disk */
  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    // Ensure the directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, buffer);
  }

  /** Convert sql.js result columns + values to an array of objects */
  private resultToObjects(result: { columns: string[]; values: unknown[][] }[]): Record<string, unknown>[] {
    if (!result || result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /** Run a SELECT query and return all rows as objects */
  query(sql: string, params?: unknown[]): Record<string, unknown>[] {
    if (!this.db) throw new Error('Database not open');
    const result = this.db.exec(sql, params as any[]);
    return this.resultToObjects(result);
  }

  /** Execute a write statement (INSERT/UPDATE/DELETE) */
  execute(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
    if (!this.db) throw new Error('Database not open');
    this.db.run(sql, params as any[]);
    const changes = this.db.getRowsModified();
    const lastIdResult = this.db.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowid = lastIdResult.length > 0 ? (lastIdResult[0].values[0][0] as number) : 0;
    this.save();
    return { changes, lastInsertRowid };
  }

  /** Execute multiple statements in a single transaction */
  executeMany(statements: { sql: string; params?: unknown[] }[]): void {
    if (!this.db) throw new Error('Database not open');
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const { sql, params } of statements) {
        this.db.run(sql, params as any[]);
      }
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
    this.save();
  }

  /** Check if any event data has been imported */
  hasData(): boolean {
    if (!this.db) throw new Error('Database not open');
    const result = this.db.exec("SELECT COUNT(name) as cnt FROM sqlite_master WHERE type='table'");
    if (result.length === 0) return false;
    return (result[0].values[0][0] as number) > 1;
  }

  /** Delete all data from every event table */
  clearAll(): void {
    if (!this.db) throw new Error('Database not open');
    const tables = [
      'ProcessCreate', 'FileCreationTimeChanged', 'NetworkConnectionDetected',
      'ProcessTerminated', 'DriverLoaded', 'ImageLoaded',
      'CreateRemoteThreadDetected', 'RawAccessReadDetected', 'ProcessAccessed',
      'FileCreated', 'RegistryObjectAddedOrDeleted', 'RegistryValueSet',
      'RegistryObjectRenamed', 'FileStreamCreated', 'PipeCreated', 'PipeConnected',
      'WMIFilter', 'WMIConsumer', 'WMIBinding', 'DNSQuery',
      'FileDeleteArchived', 'ClipboardChange', 'ProcessTampering', 'FileDeleteDetected',
      'AllEvents', 'AllHashes', 'AllIPAddresses', 'AllHosts',
      'AllRegTargets', 'AllImageExes', 'AllPorts', 'NetworkConversations',
      'SysmonViewVersion',
    ];
    this.db.run('BEGIN TRANSACTION');
    for (const table of tables) {
      this.db.run(`DELETE FROM ${table};`);
    }
    this.db.run('COMMIT');
    this.save();
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }

  // ─── Schema Definition ─────────────────────────────────────────────────────
  // Ported 1:1 from Delphi DataUnit.dfm → FDQueryBuildDatabaseStructure

  private createSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      -- ═══════════════════════════════════════════════════════════════════════
      -- Aggregation / Lookup Tables
      -- ═══════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS AllEvents (
        UtcTime       DATETIME,
        EventType     SMALLINT DEFAULT 8,
        EventTypeName VARCHAR,
        GID           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        CorrelationGuid VARCHAR DEFAULT '' NOT NULL,
        EventDetails  VARCHAR DEFAULT '',
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      CREATE TABLE IF NOT EXISTS AllHashes (
        FID           INTEGER,
        UtcTime       DATETIME,
        ReportedByVT  VARCHAR DEFAULT 'Never asked',
        MD5           VARCHAR DEFAULT 'nohash',
        SHA1          VARCHAR DEFAULT 'nohash',
        SHA256        VARCHAR DEFAULT 'nohash',
        IMPHASH       VARCHAR DEFAULT 'nohash'
      );

      CREATE TABLE IF NOT EXISTS AllIPAddresses (
        FID           INTEGER,
        UtcTime       DATETIME,
        IPAddress     VARCHAR,
        Direction     VARCHAR,
        Initiated     BOOLEAN
      );

      CREATE TABLE IF NOT EXISTS AllHosts (
        FID           INTEGER,
        UtcTime       DATETIME,
        Hostname      VARCHAR
      );

      CREATE TABLE IF NOT EXISTS AllRegTargets (
        FID           INTEGER,
        UtcTime       DATETIME,
        TargetObject  VARCHAR
      );

      CREATE TABLE IF NOT EXISTS AllImageExes (
        FID           INTEGER,
        UtcTime       DATETIME,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        ProcessGuid   VARCHAR DEFAULT '',
        EventType     SMALLINT,
        EventTypeName VARCHAR DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS AllPorts (
        FID           INTEGER,
        UtcTime       DATETIME,
        Port          VARCHAR,
        PortName      VARCHAR DEFAULT '',
        Direction     VARCHAR
      );

      -- ═══════════════════════════════════════════════════════════════════════
      -- Sysmon Event Tables (one per event type)
      -- ═══════════════════════════════════════════════════════════════════════

      -- Event ID 1: Process Create
      CREATE TABLE IF NOT EXISTS ProcessCreate (
        UtcTime             DATETIME,
        ProcessGuid         VARCHAR,
        ProcessId           INTEGER,
        Image               VARCHAR,
        CommandLine         VARCHAR,
        CurrentDirectory    VARCHAR,
        User                VARCHAR,
        LogonGuid           VARCHAR,
        LogonId             BIGINT,
        TerminalSessionId   INTEGER,
        IntegrityLevel      VARCHAR,
        Hashes              VARCHAR DEFAULT 'nohash',
        MD5                 VARCHAR DEFAULT 'nohash',
        SHA1                VARCHAR DEFAULT 'nohash',
        SHA256              VARCHAR DEFAULT 'nohash',
        IMPHASH             VARCHAR DEFAULT 'nohash',
        ParentProcessGuid   VARCHAR,
        ParentProcessId     INTEGER,
        ParentImage         VARCHAR,
        ParentCommandLine   VARCHAR,
        ImageExe            VARCHAR,
        ParentImageExe      VARCHAR,
        EventType           SMALLINT DEFAULT 1,
        EventTypeName       VARCHAR DEFAULT 'Process Create',
        FID                 INTEGER NOT NULL,
        Computer            VARCHAR,
        RuleName            VARCHAR,
        OriginalFileName    VARCHAR
      );

      -- Event ID 2: File Creation Time Changed
      CREATE TABLE IF NOT EXISTS FileCreationTimeChanged (
        UtcTime                 DATETIME,
        ProcessGuid             VARCHAR,
        ProcessId               INTEGER,
        Image                   VARCHAR,
        TargetFilename          VARCHAR,
        CreationUtcTime         DATETIME,
        PreviousCreationUtcTime DATETIME,
        ImageExe                VARCHAR,
        EventType               SMALLINT DEFAULT 2,
        EventTypeName           VARCHAR DEFAULT 'File Creation Time Changed',
        FID                     INTEGER NOT NULL,
        Computer                VARCHAR,
        RuleName                VARCHAR
      );

      -- Event ID 3: Network Connection Detected
      CREATE TABLE IF NOT EXISTS NetworkConnectionDetected (
        UtcTime                 DATETIME,
        ProcessGuid             VARCHAR,
        ProcessId               INTEGER,
        Image                   VARCHAR,
        User                    VARCHAR,
        Protocol                VARCHAR,
        Initiated               BIT,
        SourceIsIpv6            BIT,
        SourceIp                VARCHAR DEFAULT '0.0.0.0',
        SourceHostname          VARCHAR,
        SourcePort              VARCHAR,
        SourcePortName          VARCHAR,
        SourceCountry           VARCHAR DEFAULT 'n/a',
        SourceCountryCode       VARCHAR DEFAULT 'n/a',
        DestinationIsIpv6       BIT,
        DestinationIp           VARCHAR DEFAULT '0.0.0.0',
        DestinationHostname     VARCHAR,
        DestinationPort         VARCHAR,
        DestinationPortName     VARCHAR,
        DestinationCountry      VARCHAR DEFAULT 'n/a',
        DestinationCountryCode  VARCHAR DEFAULT 'n/a',
        ImageExe                VARCHAR,
        EventType               SMALLINT DEFAULT 3,
        EventTypeName           VARCHAR DEFAULT 'Network Connection Detected',
        FID                     INTEGER NOT NULL,
        Computer                VARCHAR,
        RuleName                VARCHAR
      );

      -- Event ID 5: Process Terminated
      CREATE TABLE IF NOT EXISTS ProcessTerminated (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 5,
        EventTypeName VARCHAR DEFAULT 'Process Terminated',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 6: Driver Loaded
      CREATE TABLE IF NOT EXISTS DriverLoaded (
        UtcTime       DATETIME,
        ImageLoaded   VARCHAR,
        Hashes        VARCHAR DEFAULT 'nohash',
        MD5           VARCHAR DEFAULT 'nohash',
        SHA1          VARCHAR DEFAULT 'nohash',
        SHA256        VARCHAR DEFAULT 'nohash',
        IMPHASH       VARCHAR DEFAULT 'nohash',
        Signed        VARCHAR,
        Signature     VARCHAR,
        EventType     SMALLINT DEFAULT 6,
        EventTypeName VARCHAR DEFAULT 'Driver Loaded',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 7: Image Loaded
      CREATE TABLE IF NOT EXISTS ImageLoaded (
        UtcTime          DATETIME,
        ProcessGuid      VARCHAR,
        ProcessId        INTEGER,
        Image            VARCHAR,
        ImageLoaded      VARCHAR,
        Hashes           VARCHAR DEFAULT 'nohash',
        MD5              VARCHAR DEFAULT 'nohash',
        SHA1             VARCHAR DEFAULT 'nohash',
        SHA256           VARCHAR DEFAULT 'nohash',
        IMPHASH          VARCHAR DEFAULT 'nohash',
        Signed           VARCHAR,
        Signature        VARCHAR,
        ImageExe         VARCHAR,
        ImageLoadedExe   VARCHAR,
        EventType        SMALLINT DEFAULT 7,
        EventTypeName    VARCHAR DEFAULT 'Image Loaded',
        FID              INTEGER NOT NULL,
        Computer         VARCHAR,
        RuleName         VARCHAR,
        OriginalFileName VARCHAR
      );

      -- Event ID 8: CreateRemoteThread Detected
      CREATE TABLE IF NOT EXISTS CreateRemoteThreadDetected (
        UtcTime           DATETIME,
        SourceProcessGuid VARCHAR,
        SourceProcessId   INTEGER,
        SourceImage       VARCHAR,
        TargetProcessGuid VARCHAR,
        TargetProcessId   INTEGER,
        TargetImage       VARCHAR,
        NewThreadId       INTEGER,
        StartAddress      VARCHAR,
        StartModule       VARCHAR,
        StartFunction     VARCHAR,
        SourceImageExe    VARCHAR,
        TargetImageExe    VARCHAR,
        EventType         SMALLINT DEFAULT 8,
        EventTypeName     VARCHAR DEFAULT 'CreateRemoteThread Detected',
        FID               INTEGER NOT NULL,
        Computer          VARCHAR,
        RuleName          VARCHAR
      );

      -- Event ID 9: RawAccessRead Detected
      CREATE TABLE IF NOT EXISTS RawAccessReadDetected (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        Device        VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 9,
        EventTypeName VARCHAR DEFAULT 'RawAccessRead Detected',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 10: Process Accessed
      CREATE TABLE IF NOT EXISTS ProcessAccessed (
        UtcTime            DATETIME,
        SourceProcessGUID  VARCHAR,
        SourceProcessId    INTEGER,
        SourceThreadId     INTEGER,
        SourceImage        VARCHAR,
        TargetProcessGUID  VARCHAR,
        TargetProcessId    INTEGER,
        TargetImage        VARCHAR,
        GrantedAccess      INTEGER,
        CallTrace          VARCHAR,
        SourceImageExe     VARCHAR,
        TargetImageExe     VARCHAR,
        EventType          SMALLINT DEFAULT 10,
        EventTypeName      VARCHAR DEFAULT 'Process Accessed',
        FID                INTEGER NOT NULL,
        Computer           VARCHAR,
        RuleName           VARCHAR
      );

      -- Event ID 11: File Created
      CREATE TABLE IF NOT EXISTS FileCreated (
        UtcTime         DATETIME,
        ProcessGuid     VARCHAR,
        ProcessId       INTEGER,
        Image           VARCHAR,
        TargetFilename  VARCHAR,
        GrantedAccess   INTEGER,
        CreationUtcTime DATETIME,
        ImageExe        VARCHAR,
        EventType       SMALLINT DEFAULT 11,
        EventTypeName   VARCHAR DEFAULT 'File Created',
        FID             INTEGER NOT NULL,
        Computer        VARCHAR,
        RuleName        VARCHAR
      );

      -- Event ID 12: Registry Object Added or Deleted
      CREATE TABLE IF NOT EXISTS RegistryObjectAddedOrDeleted (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        EventType2    VARCHAR,
        TargetObject  VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 12,
        EventTypeName VARCHAR DEFAULT 'Registry Object Added Or Deleted',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 13: Registry Value Set
      CREATE TABLE IF NOT EXISTS RegistryValueSet (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        EventType2    VARCHAR,
        TargetObject  VARCHAR,
        Details       VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 13,
        EventTypeName VARCHAR DEFAULT 'Registry Value Set',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 14: Registry Object Renamed
      CREATE TABLE IF NOT EXISTS RegistryObjectRenamed (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        EventType2    VARCHAR,
        TargetObject  VARCHAR,
        NewName       VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 14,
        EventTypeName VARCHAR DEFAULT 'Registry Object Renamed',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 15: File Stream Created
      CREATE TABLE IF NOT EXISTS FileStreamCreated (
        UtcTime         DATETIME,
        ProcessGuid     VARCHAR,
        ProcessId       INTEGER,
        Image           VARCHAR,
        TargetFilename  VARCHAR,
        CreationUtcTime DATETIME,
        Hashes          VARCHAR DEFAULT 'nohash',
        MD5             VARCHAR DEFAULT 'nohash',
        SHA1            VARCHAR DEFAULT 'nohash',
        SHA256          VARCHAR DEFAULT 'nohash',
        IMPHASH         VARCHAR DEFAULT 'nohash',
        ImageExe        VARCHAR,
        EventType       SMALLINT DEFAULT 15,
        EventTypeName   VARCHAR DEFAULT 'File Stream Created',
        FID             INTEGER NOT NULL,
        Computer        VARCHAR,
        RuleName        VARCHAR
      );

      -- Event ID 17: Pipe Created
      CREATE TABLE IF NOT EXISTS PipeCreated (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        PipeName      VARCHAR,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 17,
        EventTypeName VARCHAR DEFAULT 'Pipe Created',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 18: Pipe Connected
      CREATE TABLE IF NOT EXISTS PipeConnected (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        PipeName      VARCHAR,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        EventType     SMALLINT DEFAULT 18,
        EventTypeName VARCHAR DEFAULT 'Pipe Connected',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 19: WMI Event Filter Activity Detected
      CREATE TABLE IF NOT EXISTS WMIFilter (
        UtcTime        DATETIME,
        Operation      VARCHAR,
        User           VARCHAR,
        EventNamespace VARCHAR,
        Name           VARCHAR,
        Query          VARCHAR,
        EventType      SMALLINT DEFAULT 19,
        EventTypeName  VARCHAR DEFAULT 'WmiEventFilter Activity Detected',
        FID            INTEGER NOT NULL,
        Computer       VARCHAR,
        RuleName       VARCHAR
      );

      -- Event ID 20: WMI Event Consumer Activity Detected
      CREATE TABLE IF NOT EXISTS WMIConsumer (
        UtcTime       DATETIME,
        Operation     VARCHAR,
        User          VARCHAR,
        Name          VARCHAR,
        Type          VARCHAR,
        Destination   VARCHAR,
        EventType     SMALLINT DEFAULT 20,
        EventTypeName VARCHAR DEFAULT 'WmiEventConsumer Activity Detected',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 21: WMI Event Consumer To Filter Activity Detected
      CREATE TABLE IF NOT EXISTS WMIBinding (
        UtcTime       DATETIME,
        Operation     VARCHAR,
        User          VARCHAR,
        Consumer      VARCHAR,
        Filter        VARCHAR,
        EventType     SMALLINT DEFAULT 21,
        EventTypeName VARCHAR DEFAULT 'WmiEventConsumerToFilter Activity Detected',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 22: DNS Query
      CREATE TABLE IF NOT EXISTS DNSQuery (
        UtcTime                DATETIME,
        ProcessGuid            VARCHAR,
        ProcessId              INTEGER,
        Image                  VARCHAR,
        ImageExe               VARCHAR,
        QueryName              VARCHAR,
        QueryStatus            VARCHAR,
        QueryStatusDescription VARCHAR,
        QueryResults           VARCHAR,
        EventType              SMALLINT DEFAULT 22,
        EventTypeName          VARCHAR DEFAULT 'DNS Query',
        FID                    INTEGER NOT NULL,
        Computer               VARCHAR,
        RuleName               VARCHAR
      );

      -- Event ID 23: File Delete Archived
      CREATE TABLE IF NOT EXISTS FileDeleteArchived (
        UtcTime         DATETIME,
        ProcessGuid     VARCHAR,
        ProcessId       INTEGER,
        Image           VARCHAR,
        ImageExe        VARCHAR,
        Hashes          VARCHAR DEFAULT 'nohash',
        MD5             VARCHAR DEFAULT 'nohash',
        SHA1            VARCHAR DEFAULT 'nohash',
        SHA256          VARCHAR DEFAULT 'nohash',
        IMPHASH         VARCHAR DEFAULT 'nohash',
        User            VARCHAR,
        TargetFilename  VARCHAR,
        IsExecutable    BIT,
        Archived        VARCHAR,
        EventType       SMALLINT DEFAULT 23,
        EventTypeName   VARCHAR DEFAULT 'File Delete Archived',
        FID             INTEGER NOT NULL,
        Computer        VARCHAR,
        RuleName        VARCHAR
      );

      -- Event ID 24: Clipboard Change
      CREATE TABLE IF NOT EXISTS ClipboardChange (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        Session       VARCHAR,
        Hashes        VARCHAR DEFAULT 'nohash',
        MD5           VARCHAR DEFAULT 'nohash',
        SHA1          VARCHAR DEFAULT 'nohash',
        SHA256        VARCHAR DEFAULT 'nohash',
        IMPHASH       VARCHAR DEFAULT 'nohash',
        ClientInfo    VARCHAR,
        Archived      VARCHAR,
        EventType     SMALLINT DEFAULT 24,
        EventTypeName VARCHAR DEFAULT 'Clipboard Changed',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 25: Process Tampering
      CREATE TABLE IF NOT EXISTS ProcessTampering (
        UtcTime       DATETIME,
        ProcessGuid   VARCHAR,
        ProcessId     INTEGER,
        Image         VARCHAR,
        ImageExe      VARCHAR,
        EventType2    VARCHAR,
        EventType     SMALLINT DEFAULT 25,
        EventTypeName VARCHAR DEFAULT 'Process Tampering',
        FID           INTEGER NOT NULL,
        Computer      VARCHAR,
        RuleName      VARCHAR
      );

      -- Event ID 26: File Delete Detected (Logged)
      CREATE TABLE IF NOT EXISTS FileDeleteDetected (
        UtcTime         DATETIME,
        ProcessGuid     VARCHAR,
        ProcessId       INTEGER,
        Image           VARCHAR,
        ImageExe        VARCHAR,
        Hashes          VARCHAR DEFAULT 'nohash',
        MD5             VARCHAR DEFAULT 'nohash',
        SHA1            VARCHAR DEFAULT 'nohash',
        SHA256          VARCHAR DEFAULT 'nohash',
        IMPHASH         VARCHAR DEFAULT 'nohash',
        User            VARCHAR,
        TargetFilename  VARCHAR,
        IsExecutable    BIT,
        EventType       SMALLINT DEFAULT 26,
        EventTypeName   VARCHAR DEFAULT 'File Delete Logged',
        FID             INTEGER NOT NULL,
        Computer        VARCHAR,
        RuleName        VARCHAR
      );

      -- ═══════════════════════════════════════════════════════════════════════
      -- Network Conversations (PCAP import)
      -- ═══════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS NetworkConversations (
        Protocol       VARCHAR,
        SourceIp       VARCHAR,
        SourcePort     VARCHAR,
        DestinationIp  VARCHAR,
        DestinationPort VARCHAR,
        IpVersion      VARCHAR,
        StartTime      DATETIME,
        CaptureFile    VARCHAR
      );

      -- ═══════════════════════════════════════════════════════════════════════
      -- Version Tracking
      -- ═══════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS SysmonViewVersion (
        SVersion VARCHAR
      );
    `);
  }
}
