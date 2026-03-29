import { useEffect, useState } from 'react';

/**
 * Status bar at the bottom of the window.
 * Mirrors the Delphi StatusBar showing database path and record counts.
 */
export default function StatusBar() {
  const [dbPath, setDbPath] = useState<string>('');

  useEffect(() => {
    window.sysmonApi.db.getPath().then((p) => setDbPath(p ?? ''));
  }, []);

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-surface-950 border-t border-gray-700 text-xs text-gray-500">
      <span>{dbPath ? `Database: ${dbPath}` : 'No database loaded'}</span>
      <span>Sysmon View 2.0</span>
    </div>
  );
}
