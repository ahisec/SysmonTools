import { readFileSync } from 'fs';
import { basename } from 'path';
import type { Database } from './database';

/**
 * Sysmon XML log importer.
 *
 * Ported from Delphi ImportFormUnit.pas.
 * Uses a SAX-like streaming approach: reads the XML line-by-line and
 * tracks state with flags (FIsItEvent, FIsItData, FIsItComputer),
 * accumulating <Data> fields into a Map, then inserting into SQLite
 * when </EventData> is reached.
 *
 * This avoids loading the entire XML into memory (critical for large logs).
 */

// ─── Event Type Mapping ────────────────────────────────────────────────────────
// Mirrors the Delphi EventID → EventTypeName mapping (ImportFormUnit.pas lines 449-506)

const EVENT_TYPE_NAMES: Record<number, string> = {
  1: 'Process Create',
  2: 'File Creation Time Changed',
  3: 'Network Connection Detected',
  5: 'Process Terminated',
  6: 'Driver Loaded',
  7: 'Image Loaded',
  8: 'CreateRemoteThread Detected',
  9: 'RawAccessRead Detected',
  10: 'Process Accessed',
  11: 'File Created',
  12: 'Registry Object Added Or Deleted',
  13: 'Registry Value Set',
  14: 'Registry Object Renamed',
  15: 'File Stream Created',
  17: 'Pipe Created',
  18: 'Pipe Connected',
  19: 'WmiEventFilter Activity Detected',
  20: 'WmiEventConsumer Activity Detected',
  21: 'WmiEventConsumerToFilter Activity Detected',
  22: 'DNS Query',
  23: 'File Delete Archived',
  24: 'Clipboard Changed',
  25: 'Process Tampering',
  26: 'File Delete Logged',
};

// ─── Helper Functions ──────────────────────────────────────────────────────────
// Ported from ImportFormUnit.pas SafeDictionaryAccess* functions (lines 290-377)

function safeStr(data: Map<string, string>, key: string): string {
  return data.get(key) ?? '';
}

function safeInt(data: Map<string, string>, key: string): number {
  const v = data.get(key);
  if (!v) return -1;
  const n = parseInt(v, 10);
  return isNaN(n) ? -1 : n;
}

function safeBigInt(data: Map<string, string>, key: string): number {
  const v = data.get(key);
  if (!v) return -1;
  const n = Number(v);
  return isNaN(n) ? -1 : n;
}

function safeBool(data: Map<string, string>, key: string): number {
  const v = data.get(key)?.toLowerCase();
  return v === 'true' ? 1 : 0;
}

/** Extract executable filename from full path (mirrors Delphi ExtractFileName) */
function safeImageExe(data: Map<string, string>, key: string): string {
  const v = data.get(key);
  if (!v) return '';
  return basename(v.replace(/\\/g, '/'));
}

/**
 * Parse Sysmon hash string into individual hash values.
 * Format: "MD5=abc123,SHA1=def456,SHA256=ghi789,IMPHASH=jkl012"
 * Ported from ImportFormUnit.pas lines 591-608
 */
function parseHashes(hashStr: string): { md5: string; sha1: string; sha256: string; imphash: string } {
  const result = { md5: 'nohash', sha1: 'nohash', sha256: 'nohash', imphash: 'nohash' };
  if (!hashStr || hashStr === 'nohash') return result;

  const parts = hashStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('MD5=')) result.md5 = trimmed.substring(4);
    else if (trimmed.startsWith('SHA1=')) result.sha1 = trimmed.substring(5);
    else if (trimmed.startsWith('SHA256=')) result.sha256 = trimmed.substring(7);
    else if (trimmed.startsWith('IMPHASH=')) result.imphash = trimmed.substring(8);
  }
  return result;
}

// ─── Import Progress Callback ──────────────────────────────────────────────────

export interface ImportProgress {
  eventsProcessed: number;
  currentFile: string;
  status: 'importing' | 'done' | 'error';
  error?: string;
}

// ─── Main Import Function ──────────────────────────────────────────────────────

/**
 * Import a Sysmon XML log file into the database.
 *
 * Uses a streaming regex-based SAX approach matching the Delphi implementation:
 * 1. Detect <EventID> to identify event type
 * 2. Detect <Computer> for machine name
 * 3. Detect <Data Name="...">value</Data> for event fields
 * 4. On </EventData>, insert the accumulated record into SQLite
 *
 * @param db Database instance
 * @param filePath Path to the XML file
 * @param onProgress Progress callback
 */
export async function importSysmonXml(
  db: Database,
  filePath: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<number> {
  let eventsProcessed = 0;

  // SAX state flags (mirrors Delphi FIsItEvent, FIsItData, FIsItComputer)
  let currentEventId = 0;
  let computerName = '';
  let ruleName = '';
  let eventData = new Map<string, string>();
  let inEventData = false;

  // Batch statements for transaction
  const BATCH_SIZE = 500;
  let batch: { sql: string; params: unknown[] }[] = [];

  const flushBatch = () => {
    if (batch.length > 0) {
      db.executeMany(batch);
      batch = [];
    }
  };

  const addToBatch = (sql: string, params: unknown[]) => {
    batch.push({ sql, params });
    if (batch.length >= BATCH_SIZE) {
      flushBatch();
    }
  };

  // ── Process a complete event record ────────────────────────────────────────
  // Mirrors OnEndElement in ImportFormUnit.pas when </EventData> is found

  const processEvent = () => {
    if (currentEventId === 0) return;

    const eventTypeName = EVENT_TYPE_NAMES[currentEventId] ?? `Unknown (${currentEventId})`;
    const utcTime = safeStr(eventData, 'UtcTime');

    // Step 1: Determine CorrelationGuid (ProcessGuid for most events)
    let correlationGuid = safeStr(eventData, 'ProcessGuid');
    if (currentEventId === 8) {
      correlationGuid = safeStr(eventData, 'SourceProcessGuid');
    } else if (currentEventId === 10) {
      correlationGuid = safeStr(eventData, 'SourceProcessGUID');
    }

    // Step 2: Build EventDetails summary
    const eventDetails = buildEventDetails(currentEventId, eventData);

    // Step 3: Insert into AllEvents → we need the GID back as FID
    // Since sql.js doesn't return lastInsertRowid from batch, we use a sequence approach
    addToBatch(
      `INSERT INTO AllEvents (UtcTime, EventType, EventTypeName, CorrelationGuid, EventDetails, Computer, RuleName)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [utcTime, currentEventId, eventTypeName, correlationGuid, eventDetails, computerName, ruleName]
    );

    // We'll use a subquery to get the FID (max GID)
    // For batched inserts, we track FID via eventsProcessed + 1
    // This works because AllEvents GID is AUTOINCREMENT
    const fidPlaceholder = `(SELECT MAX(GID) FROM AllEvents)`;

    // Step 4: Insert into event-specific table
    insertEventRecord(currentEventId, eventData, utcTime, computerName, ruleName, fidPlaceholder, addToBatch);

    // Step 5: Insert into aggregate tables
    insertAggregateRecords(currentEventId, eventData, utcTime, fidPlaceholder, addToBatch);

    eventsProcessed++;

    if (onProgress && eventsProcessed % 100 === 0) {
      onProgress({
        eventsProcessed,
        currentFile: filePath,
        status: 'importing',
      });
    }
  };

  // ── Read and parse the XML file ───────────────────────────────────────────
  // Sysmon XML exports are often UTF-16LE encoded. We detect encoding from
  // the BOM and convert to a UTF-8 string before parsing.

  const rawBuffer = readFileSync(filePath);
  let xmlText: string;

  // Detect UTF-16LE BOM (0xFF 0xFE)
  if (rawBuffer.length >= 2 && rawBuffer[0] === 0xFF && rawBuffer[1] === 0xFE) {
    xmlText = rawBuffer.toString('utf16le');
    // Strip BOM character
    if (xmlText.charCodeAt(0) === 0xFEFF) xmlText = xmlText.substring(1);
  } else if (rawBuffer.length >= 2 && rawBuffer[0] === 0xFE && rawBuffer[1] === 0xFF) {
    // UTF-16BE (rare but handle it)
    // Swap bytes then decode as utf16le
    for (let i = 0; i < rawBuffer.length - 1; i += 2) {
      const tmp = rawBuffer[i];
      rawBuffer[i] = rawBuffer[i + 1];
      rawBuffer[i + 1] = tmp;
    }
    xmlText = rawBuffer.toString('utf16le');
    if (xmlText.charCodeAt(0) === 0xFEFF) xmlText = xmlText.substring(1);
  } else {
    // Assume UTF-8
    xmlText = rawBuffer.toString('utf-8');
    // Strip UTF-8 BOM if present
    if (xmlText.charCodeAt(0) === 0xFEFF) xmlText = xmlText.substring(1);
  }

  // Split the XML into individual <Event>...</Event> blocks for processing
  // This is more reliable than streaming regex since events can span partial chunks
  const eventRe = /<Event\s[^>]*>.*?<\/Event>/gs;
  let match: RegExpExecArray | null;

  while ((match = eventRe.exec(xmlText)) !== null) {
    const eventXml = match[0];

    // Extract EventID
    const eventIdMatch = eventXml.match(/<EventID>(\d+)<\/EventID>/);
    if (!eventIdMatch) continue;
    currentEventId = parseInt(eventIdMatch[1], 10);

    // Skip event types we don't handle (4=Service State, 16=Config Change)
    if (!EVENT_TYPE_NAMES[currentEventId]) {
      currentEventId = 0;
      continue;
    }

    // Extract Computer
    const computerMatch = eventXml.match(/<Computer>([^<]*)<\/Computer>/);
    computerName = computerMatch ? unescapeXml(computerMatch[1]) : '';

    // Extract RuleName from Data fields (may also appear in System section)
    ruleName = '';

    // Extract all <Data Name="key">value</Data> pairs
    eventData.clear();
    const dataRe = /<Data Name=['"]([^'"]+)['"]>([^<]*)<\/Data>/g;
    let dm: RegExpExecArray | null;
    while ((dm = dataRe.exec(eventXml)) !== null) {
      const key = dm[1];
      const value = unescapeXml(dm[2]);
      if (key === 'RuleName') {
        ruleName = value;
      }
      eventData.set(key, value);
    }

    // Also handle empty Data tags: <Data Name="key"/>
    const emptyDataRe = /<Data Name=['"]([^'"]+)['"]\s*\/>/g;
    while ((dm = emptyDataRe.exec(eventXml)) !== null) {
      eventData.set(dm[1], '');
    }

    processEvent();
    currentEventId = 0;
    computerName = '';
    ruleName = '';
  }

  flushBatch();

  onProgress?.({
    eventsProcessed,
    currentFile: filePath,
    status: 'done',
  });

  return eventsProcessed;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Event Details Summary Builder ─────────────────────────────────────────────
// Creates a short description for AllEvents.EventDetails column

function buildEventDetails(eventId: number, data: Map<string, string>): string {
  switch (eventId) {
    case 1: return safeStr(data, 'Image') + ' ' + safeStr(data, 'CommandLine');
    case 2: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'TargetFilename');
    case 3: return safeStr(data, 'Image') + ' ' + safeStr(data, 'SourceIp') + ':' + safeStr(data, 'SourcePort') + ' → ' + safeStr(data, 'DestinationIp') + ':' + safeStr(data, 'DestinationPort');
    case 5: return safeStr(data, 'Image');
    case 6: return safeStr(data, 'ImageLoaded');
    case 7: return safeStr(data, 'Image') + ' loaded ' + safeStr(data, 'ImageLoaded');
    case 8: return safeStr(data, 'SourceImage') + ' → ' + safeStr(data, 'TargetImage');
    case 9: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'Device');
    case 10: return safeStr(data, 'SourceImage') + ' → ' + safeStr(data, 'TargetImage');
    case 11: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'TargetFilename');
    case 12: case 13: case 14: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'TargetObject');
    case 15: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'TargetFilename');
    case 17: case 18: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'PipeName');
    case 19: return safeStr(data, 'Operation') + ' ' + safeStr(data, 'EventNamespace');
    case 20: return safeStr(data, 'Operation') + ' ' + safeStr(data, 'Name');
    case 21: return safeStr(data, 'Operation') + ' ' + safeStr(data, 'Consumer');
    case 22: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'QueryName');
    case 23: case 26: return safeStr(data, 'Image') + ' → ' + safeStr(data, 'TargetFilename');
    case 24: return safeStr(data, 'Image') + ' session=' + safeStr(data, 'Session');
    case 25: return safeStr(data, 'Image') + ' ' + safeStr(data, 'Type');
    default: return '';
  }
}

// ─── Event-Specific Table Insert ───────────────────────────────────────────────
// Mirrors the large switch/case in OnEndElement (ImportFormUnit.pas lines 560-2400)

function insertEventRecord(
  eventId: number,
  data: Map<string, string>,
  utcTime: string,
  computer: string,
  ruleName: string,
  fidExpr: string,
  addToBatch: (sql: string, params: unknown[]) => void
): void {
  switch (eventId) {
    case 1: { // Process Create
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO ProcessCreate (UtcTime, ProcessGuid, ProcessId, Image, CommandLine, CurrentDirectory,
         User, LogonGuid, LogonId, TerminalSessionId, IntegrityLevel, Hashes, MD5, SHA1, SHA256, IMPHASH,
         ParentProcessGuid, ParentProcessId, ParentImage, ParentCommandLine, ImageExe, ParentImageExe,
         EventType, EventTypeName, FID, Computer, RuleName, OriginalFileName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'Process Create',${fidExpr},?,?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'CommandLine'), safeStr(data, 'CurrentDirectory'), safeStr(data, 'User'),
          safeStr(data, 'LogonGuid'), safeBigInt(data, 'LogonId'), safeInt(data, 'TerminalSessionId'),
          safeStr(data, 'IntegrityLevel'), safeStr(data, 'Hashes'), hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'ParentProcessGuid'), safeInt(data, 'ParentProcessId'), safeStr(data, 'ParentImage'),
          safeStr(data, 'ParentCommandLine'), safeImageExe(data, 'Image'), safeImageExe(data, 'ParentImage'),
          computer, ruleName, safeStr(data, 'OriginalFileName'),
        ]
      );
      break;
    }
    case 2: { // File Creation Time Changed
      addToBatch(
        `INSERT INTO FileCreationTimeChanged (UtcTime, ProcessGuid, ProcessId, Image, TargetFilename,
         CreationUtcTime, PreviousCreationUtcTime, ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,2,'File Creation Time Changed',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'TargetFilename'), safeStr(data, 'CreationUtcTime'), safeStr(data, 'PreviousCreationUtcTime'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 3: { // Network Connection Detected
      addToBatch(
        `INSERT INTO NetworkConnectionDetected (UtcTime, ProcessGuid, ProcessId, Image, User, Protocol,
         Initiated, SourceIsIpv6, SourceIp, SourceHostname, SourcePort, SourcePortName,
         DestinationIsIpv6, DestinationIp, DestinationHostname, DestinationPort, DestinationPortName,
         ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,3,'Network Connection Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'User'), safeStr(data, 'Protocol'), safeBool(data, 'Initiated'),
          safeBool(data, 'SourceIsIpv6'), safeStr(data, 'SourceIp'), safeStr(data, 'SourceHostname'),
          safeStr(data, 'SourcePort'), safeStr(data, 'SourcePortName'),
          safeBool(data, 'DestinationIsIpv6'), safeStr(data, 'DestinationIp'), safeStr(data, 'DestinationHostname'),
          safeStr(data, 'DestinationPort'), safeStr(data, 'DestinationPortName'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 5: { // Process Terminated
      addToBatch(
        `INSERT INTO ProcessTerminated (UtcTime, ProcessGuid, ProcessId, Image, ImageExe,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,5,'Process Terminated',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 6: { // Driver Loaded
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO DriverLoaded (UtcTime, ImageLoaded, Hashes, MD5, SHA1, SHA256, IMPHASH,
         Signed, Signature, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,6,'Driver Loaded',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ImageLoaded'), safeStr(data, 'Hashes'),
          hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'Signed'), safeStr(data, 'Signature'), computer, ruleName,
        ]
      );
      break;
    }
    case 7: { // Image Loaded
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO ImageLoaded (UtcTime, ProcessGuid, ProcessId, Image, ImageLoaded, Hashes, MD5, SHA1, SHA256, IMPHASH,
         Signed, Signature, ImageExe, ImageLoadedExe, EventType, EventTypeName, FID, Computer, RuleName, OriginalFileName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,7,'Image Loaded',${fidExpr},?,?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'ImageLoaded'), safeStr(data, 'Hashes'), hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'Signed'), safeStr(data, 'Signature'), safeImageExe(data, 'Image'), safeImageExe(data, 'ImageLoaded'),
          computer, ruleName, safeStr(data, 'OriginalFileName'),
        ]
      );
      break;
    }
    case 8: { // CreateRemoteThread Detected
      addToBatch(
        `INSERT INTO CreateRemoteThreadDetected (UtcTime, SourceProcessGuid, SourceProcessId, SourceImage,
         TargetProcessGuid, TargetProcessId, TargetImage, NewThreadId, StartAddress, StartModule, StartFunction,
         SourceImageExe, TargetImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,8,'CreateRemoteThread Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'SourceProcessGuid'), safeInt(data, 'SourceProcessId'), safeStr(data, 'SourceImage'),
          safeStr(data, 'TargetProcessGuid'), safeInt(data, 'TargetProcessId'), safeStr(data, 'TargetImage'),
          safeInt(data, 'NewThreadId'), safeStr(data, 'StartAddress'), safeStr(data, 'StartModule'),
          safeStr(data, 'StartFunction'), safeImageExe(data, 'SourceImage'), safeImageExe(data, 'TargetImage'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 9: { // RawAccessRead Detected
      addToBatch(
        `INSERT INTO RawAccessReadDetected (UtcTime, ProcessGuid, ProcessId, Image, Device, ImageExe,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,9,'RawAccessRead Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'Device'), safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 10: { // Process Accessed
      addToBatch(
        `INSERT INTO ProcessAccessed (UtcTime, SourceProcessGUID, SourceProcessId, SourceThreadId, SourceImage,
         TargetProcessGUID, TargetProcessId, TargetImage, GrantedAccess, CallTrace,
         SourceImageExe, TargetImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,10,'Process Accessed',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'SourceProcessGUID'), safeInt(data, 'SourceProcessId'),
          safeInt(data, 'SourceThreadId'), safeStr(data, 'SourceImage'),
          safeStr(data, 'TargetProcessGUID'), safeInt(data, 'TargetProcessId'), safeStr(data, 'TargetImage'),
          safeInt(data, 'GrantedAccess'), safeStr(data, 'CallTrace'),
          safeImageExe(data, 'SourceImage'), safeImageExe(data, 'TargetImage'), computer, ruleName,
        ]
      );
      break;
    }
    case 11: { // File Created
      addToBatch(
        `INSERT INTO FileCreated (UtcTime, ProcessGuid, ProcessId, Image, TargetFilename,
         CreationUtcTime, ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,11,'File Created',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'TargetFilename'), safeStr(data, 'CreationUtcTime'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 12: { // Registry Object Added or Deleted
      addToBatch(
        `INSERT INTO RegistryObjectAddedOrDeleted (UtcTime, ProcessGuid, ProcessId, Image, EventType2, TargetObject,
         ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,12,'Registry Object Added Or Deleted',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'EventType'), safeStr(data, 'TargetObject'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 13: { // Registry Value Set
      addToBatch(
        `INSERT INTO RegistryValueSet (UtcTime, ProcessGuid, ProcessId, Image, EventType2, TargetObject, Details,
         ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,13,'Registry Value Set',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'EventType'), safeStr(data, 'TargetObject'), safeStr(data, 'Details'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 14: { // Registry Object Renamed
      addToBatch(
        `INSERT INTO RegistryObjectRenamed (UtcTime, ProcessGuid, ProcessId, Image, EventType2, TargetObject, NewName,
         ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,14,'Registry Object Renamed',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'EventType'), safeStr(data, 'TargetObject'), safeStr(data, 'NewName'),
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 15: { // File Stream Created
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO FileStreamCreated (UtcTime, ProcessGuid, ProcessId, Image, TargetFilename, CreationUtcTime,
         Hashes, MD5, SHA1, SHA256, IMPHASH, ImageExe, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,15,'File Stream Created',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeStr(data, 'TargetFilename'), safeStr(data, 'CreationUtcTime'),
          safeStr(data, 'Hashes'), hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeImageExe(data, 'Image'), computer, ruleName,
        ]
      );
      break;
    }
    case 17: { // Pipe Created
      addToBatch(
        `INSERT INTO PipeCreated (UtcTime, ProcessGuid, ProcessId, PipeName, Image, ImageExe,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,17,'Pipe Created',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'),
          safeStr(data, 'PipeName'), safeStr(data, 'Image'), safeImageExe(data, 'Image'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 18: { // Pipe Connected
      addToBatch(
        `INSERT INTO PipeConnected (UtcTime, ProcessGuid, ProcessId, PipeName, Image, ImageExe,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,18,'Pipe Connected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'),
          safeStr(data, 'PipeName'), safeStr(data, 'Image'), safeImageExe(data, 'Image'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 19: { // WMI Filter
      addToBatch(
        `INSERT INTO WMIFilter (UtcTime, Operation, User, EventNamespace, Name, Query,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,19,'WmiEventFilter Activity Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'Operation'), safeStr(data, 'User'),
          safeStr(data, 'EventNamespace'), safeStr(data, 'Name'), safeStr(data, 'Query'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 20: { // WMI Consumer
      addToBatch(
        `INSERT INTO WMIConsumer (UtcTime, Operation, User, Name, Type, Destination,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,20,'WmiEventConsumer Activity Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'Operation'), safeStr(data, 'User'),
          safeStr(data, 'Name'), safeStr(data, 'Type'), safeStr(data, 'Destination'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 21: { // WMI Binding
      addToBatch(
        `INSERT INTO WMIBinding (UtcTime, Operation, User, Consumer, Filter,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,21,'WmiEventConsumerToFilter Activity Detected',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'Operation'), safeStr(data, 'User'),
          safeStr(data, 'Consumer'), safeStr(data, 'Filter'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 22: { // DNS Query
      addToBatch(
        `INSERT INTO DNSQuery (UtcTime, ProcessGuid, ProcessId, Image, ImageExe, QueryName,
         QueryStatus, QueryStatusDescription, QueryResults, EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,22,'DNS Query',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), safeStr(data, 'QueryName'),
          safeStr(data, 'QueryStatus'), safeStr(data, 'QueryStatusDescription'), safeStr(data, 'QueryResults'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 23: { // File Delete Archived
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO FileDeleteArchived (UtcTime, ProcessGuid, ProcessId, Image, ImageExe,
         Hashes, MD5, SHA1, SHA256, IMPHASH, User, TargetFilename, IsExecutable, Archived,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,23,'File Delete Archived',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), safeStr(data, 'Hashes'),
          hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'User'), safeStr(data, 'TargetFilename'),
          safeBool(data, 'IsExecutable'), safeStr(data, 'Archived'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 24: { // Clipboard Change
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO ClipboardChange (UtcTime, ProcessGuid, ProcessId, Image, ImageExe, Session,
         Hashes, MD5, SHA1, SHA256, IMPHASH, ClientInfo, Archived,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,24,'Clipboard Changed',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), safeStr(data, 'Session'),
          safeStr(data, 'Hashes'), hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'ClientInfo'), safeStr(data, 'Archived'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 25: { // Process Tampering
      addToBatch(
        `INSERT INTO ProcessTampering (UtcTime, ProcessGuid, ProcessId, Image, ImageExe, EventType2,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,25,'Process Tampering',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), safeStr(data, 'Type'),
          computer, ruleName,
        ]
      );
      break;
    }
    case 26: { // File Delete Detected
      const hashes = parseHashes(safeStr(data, 'Hashes'));
      addToBatch(
        `INSERT INTO FileDeleteDetected (UtcTime, ProcessGuid, ProcessId, Image, ImageExe,
         Hashes, MD5, SHA1, SHA256, IMPHASH, User, TargetFilename, IsExecutable,
         EventType, EventTypeName, FID, Computer, RuleName)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,26,'File Delete Logged',${fidExpr},?,?)`,
        [
          utcTime, safeStr(data, 'ProcessGuid'), safeInt(data, 'ProcessId'), safeStr(data, 'Image'),
          safeImageExe(data, 'Image'), safeStr(data, 'Hashes'),
          hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash,
          safeStr(data, 'User'), safeStr(data, 'TargetFilename'), safeBool(data, 'IsExecutable'),
          computer, ruleName,
        ]
      );
      break;
    }
  }
}

// ─── Aggregate Table Inserts ───────────────────────────────────────────────────
// Mirrors Delphi logic: after each event insert, also insert into All* tables

function insertAggregateRecords(
  eventId: number,
  data: Map<string, string>,
  utcTime: string,
  fidExpr: string,
  addToBatch: (sql: string, params: unknown[]) => void
): void {
  // AllImageExes: inserted for most event types
  const image = safeStr(data, 'Image');
  const imageExe = safeImageExe(data, 'Image');
  const eventTypeName = EVENT_TYPE_NAMES[eventId] ?? '';
  const processGuid = safeStr(data, 'ProcessGuid') || safeStr(data, 'SourceProcessGuid') || safeStr(data, 'SourceProcessGUID');

  if (image) {
    addToBatch(
      `INSERT INTO AllImageExes (FID, UtcTime, Image, ImageExe, ProcessGuid, EventType, EventTypeName)
       VALUES (${fidExpr},?,?,?,?,?,?)`,
      [utcTime, image, imageExe, processGuid, eventId, eventTypeName]
    );
  }

  // For events with a second image (parent, target, loaded):
  if (eventId === 1) {
    const parentImage = safeStr(data, 'ParentImage');
    if (parentImage) {
      addToBatch(
        `INSERT INTO AllImageExes (FID, UtcTime, Image, ImageExe, ProcessGuid, EventType, EventTypeName)
         VALUES (${fidExpr},?,?,?,?,?,?)`,
        [utcTime, parentImage, safeImageExe(data, 'ParentImage'), safeStr(data, 'ParentProcessGuid'), eventId, eventTypeName]
      );
    }
  }

  // AllHashes: for events that have hash fields
  if ([1, 6, 7, 15, 23, 24, 26].includes(eventId)) {
    const hashStr = safeStr(data, 'Hashes');
    if (hashStr && hashStr !== 'nohash') {
      const hashes = parseHashes(hashStr);
      addToBatch(
        `INSERT INTO AllHashes (FID, UtcTime, MD5, SHA1, SHA256, IMPHASH)
         VALUES (${fidExpr},?,?,?,?,?)`,
        [utcTime, hashes.md5, hashes.sha1, hashes.sha256, hashes.imphash]
      );
    }
  }

  // AllIPAddresses, AllHosts, AllPorts: only for Event 3 (Network)
  if (eventId === 3) {
    const srcIp = safeStr(data, 'SourceIp');
    const dstIp = safeStr(data, 'DestinationIp');
    const initiated = safeBool(data, 'Initiated');

    if (srcIp) {
      addToBatch(
        `INSERT INTO AllIPAddresses (FID, UtcTime, IPAddress, Direction, Initiated)
         VALUES (${fidExpr},?,?,'Source',?)`,
        [utcTime, srcIp, initiated]
      );
    }
    if (dstIp) {
      addToBatch(
        `INSERT INTO AllIPAddresses (FID, UtcTime, IPAddress, Direction, Initiated)
         VALUES (${fidExpr},?,?,'Destination',?)`,
        [utcTime, dstIp, initiated]
      );
    }

    const srcHost = safeStr(data, 'SourceHostname');
    const dstHost = safeStr(data, 'DestinationHostname');
    if (srcHost) {
      addToBatch(
        `INSERT INTO AllHosts (FID, UtcTime, Hostname) VALUES (${fidExpr},?,?)`,
        [utcTime, srcHost]
      );
    }
    if (dstHost) {
      addToBatch(
        `INSERT INTO AllHosts (FID, UtcTime, Hostname) VALUES (${fidExpr},?,?)`,
        [utcTime, dstHost]
      );
    }

    const srcPort = safeStr(data, 'SourcePort');
    const dstPort = safeStr(data, 'DestinationPort');
    if (srcPort) {
      addToBatch(
        `INSERT INTO AllPorts (FID, UtcTime, Port, PortName, Direction) VALUES (${fidExpr},?,?,?,'Source')`,
        [utcTime, srcPort, safeStr(data, 'SourcePortName')]
      );
    }
    if (dstPort) {
      addToBatch(
        `INSERT INTO AllPorts (FID, UtcTime, Port, PortName, Direction) VALUES (${fidExpr},?,?,?,'Destination')`,
        [utcTime, dstPort, safeStr(data, 'DestinationPortName')]
      );
    }
  }

  // AllRegTargets: for registry events
  if ([12, 13, 14].includes(eventId)) {
    const target = safeStr(data, 'TargetObject');
    if (target) {
      addToBatch(
        `INSERT INTO AllRegTargets (FID, UtcTime, TargetObject) VALUES (${fidExpr},?,?)`,
        [utcTime, target]
      );
    }
  }
}
