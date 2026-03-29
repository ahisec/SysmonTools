import { useEffect, useState } from 'react';

interface ToolbarProps {
  onDataImported: () => void;
  onOpenPreferences: () => void;
}

/**
 * Top toolbar matching the Delphi MainForm toolbar.
 * Provides: Import XML, Open DB, Clear, Preferences.
 */
export default function Toolbar({ onDataImported, onOpenPreferences }: ToolbarProps) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => {
    window.sysmonApi.import.onProgress((p) => {
      if (p.status === 'importing') {
        setProgress(`Importing... ${p.eventsProcessed} events`);
      } else if (p.status === 'done') {
        setProgress(`Done! ${p.eventsProcessed} events imported.`);
      } else if (p.status === 'error') {
        setProgress(`Error: ${p.error}`);
      }
    });
    return () => {
      window.sysmonApi.import.removeProgressListener();
    };
  }, []);

  const handleImportXml = async () => {
    const files = await window.sysmonApi.dialog.openXmlFiles();
    if (files.length === 0) return;

    setImporting(true);
    setProgress(`Importing ${files.length} file(s)...`);

    try {
      const totalEvents = await window.sysmonApi.import.xmlFiles(files);
      setProgress(`Done! ${totalEvents} events imported.`);
      onDataImported();
    } catch (err: any) {
      setProgress(`Error: ${err.message}`);
    } finally {
      setImporting(false);
      // Clear progress message after 5 seconds
      setTimeout(() => setProgress(''), 5000);
    }
  };

  const handleOpenDatabase = async () => {
    const filePath = await window.sysmonApi.dialog.openDatabase();
    if (!filePath) return;
    await window.sysmonApi.db.openFile(filePath);
    onDataImported();
  };

  const handleClearData = async () => {
    if (!confirm('Are you sure you want to delete all imported data?')) return;
    await window.sysmonApi.db.clearAll();
    onDataImported();
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-surface-950 border-b border-gray-700">
      <ToolButton onClick={handleImportXml} title="Import Sysmon XML logs" disabled={importing}>
        <ImportIcon />
        <span>{importing ? 'Importing...' : 'Import XML'}</span>
      </ToolButton>

      <ToolButton onClick={handleOpenDatabase} title="Open existing database" disabled={importing}>
        <FolderIcon />
        <span>Open DB</span>
      </ToolButton>

      <div className="w-px h-6 bg-gray-700 mx-1" />

      <ToolButton onClick={handleClearData} title="Clear all data" disabled={importing}>
        <TrashIcon />
        <span>Clear</span>
      </ToolButton>

      <div className="w-px h-6 bg-gray-700 mx-1" />

      <ToolButton onClick={onOpenPreferences} title="Preferences (API keys)">
        <GearIcon />
        <span>Preferences</span>
      </ToolButton>

      {/* Progress indicator */}
      {progress && (
        <div className="ml-4 text-xs text-accent-400 animate-pulse">
          {progress}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  onClick,
  title,
  children,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 rounded
                 hover:bg-surface-700 hover:text-white transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function ImportIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
