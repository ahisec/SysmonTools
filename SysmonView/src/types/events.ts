/**
 * Sysmon event type IDs and their names.
 * Maps directly to the EventType column in every table.
 */
export const SYSMON_EVENT_TYPES = {
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
} as const;

export type SysmonEventId = keyof typeof SYSMON_EVENT_TYPES;

/** Maps event type IDs to their database table names */
export const EVENT_TABLE_MAP: Record<number, string> = {
  1: 'ProcessCreate',
  2: 'FileCreationTimeChanged',
  3: 'NetworkConnectionDetected',
  5: 'ProcessTerminated',
  6: 'DriverLoaded',
  7: 'ImageLoaded',
  8: 'CreateRemoteThreadDetected',
  9: 'RawAccessReadDetected',
  10: 'ProcessAccessed',
  11: 'FileCreated',
  12: 'RegistryObjectAddedOrDeleted',
  13: 'RegistryValueSet',
  14: 'RegistryObjectRenamed',
  15: 'FileStreamCreated',
  17: 'PipeCreated',
  18: 'PipeConnected',
  19: 'WMIFilter',
  20: 'WMIConsumer',
  21: 'WMIBinding',
  22: 'DNSQuery',
  23: 'FileDeleteArchived',
  24: 'ClipboardChange',
  25: 'ProcessTampering',
  26: 'FileDeleteDetected',
};

/** Row from the AllEvents unified table */
export interface AllEventsRow {
  UtcTime: string;
  EventType: number;
  EventTypeName: string;
  GID: number;
  CorrelationGuid: string;
  EventDetails: string;
  Computer: string;
  RuleName: string;
}

/** Row from ProcessCreate table */
export interface ProcessCreateRow {
  UtcTime: string;
  ProcessGuid: string;
  ProcessId: number;
  Image: string;
  CommandLine: string;
  CurrentDirectory: string;
  User: string;
  LogonGuid: string;
  LogonId: number;
  TerminalSessionId: number;
  IntegrityLevel: string;
  Hashes: string;
  MD5: string;
  SHA1: string;
  SHA256: string;
  IMPHASH: string;
  ParentProcessGuid: string;
  ParentProcessId: number;
  ParentImage: string;
  ParentCommandLine: string;
  ImageExe: string;
  ParentImageExe: string;
  EventType: number;
  EventTypeName: string;
  FID: number;
  Computer: string;
  RuleName: string;
  OriginalFileName: string;
}

/** Row from NetworkConnectionDetected table */
export interface NetworkConnectionRow {
  UtcTime: string;
  ProcessGuid: string;
  ProcessId: number;
  Image: string;
  User: string;
  Protocol: string;
  Initiated: boolean;
  SourceIsIpv6: boolean;
  SourceIp: string;
  SourceHostname: string;
  SourcePort: string;
  SourcePortName: string;
  SourceCountry: string;
  SourceCountryCode: string;
  DestinationIsIpv6: boolean;
  DestinationIp: string;
  DestinationHostname: string;
  DestinationPort: string;
  DestinationPortName: string;
  DestinationCountry: string;
  DestinationCountryCode: string;
  ImageExe: string;
  EventType: number;
  EventTypeName: string;
  FID: number;
  Computer: string;
  RuleName: string;
}
