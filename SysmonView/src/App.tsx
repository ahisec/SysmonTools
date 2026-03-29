import { useState, useEffect } from 'react';
import Toolbar from './components/Toolbar';
import StatusBar from './components/StatusBar';
import ProcessView from './pages/ProcessView';
import AllEventsView from './pages/AllEventsView';
import MapView from './pages/MapView';
import PreferencesDialog from './components/PreferencesDialog';
import AboutDialog from './components/AboutDialog';
import DocumentationDialog from './components/DocumentationDialog';

/**
 * Main application shell.
 *
 * Mirrors the Delphi MainForm layout:
 *   - Top: Toolbar (import, clear, preferences)
 *   - Center: Tab-based content area
 *   - Bottom: Status bar
 *
 * Tabs match the Delphi PageControl:
 *   - "Process View"  (TabSheetImages)
 *   - "Map View"      (TabSheetMapView)
 *   - "All Events"    (TabSheetAllEvents)
 */

type TabId = 'process' | 'map' | 'events';

const TABS: { id: TabId; label: string }[] = [
  { id: 'process', label: 'Process View' },
  { id: 'map', label: 'Map View' },
  { id: 'events', label: 'All Events' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('process');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  const handleDataImported = () => {
    setRefreshKey((k) => k + 1);
  };

  // Listen for menu events from the main process
  useEffect(() => {
    window.sysmonApi.menu.on('about', () => setShowAbout(true));
    window.sysmonApi.menu.on('documentation', () => setShowDocs(true));
    window.sysmonApi.menu.on('preferences', () => setShowPreferences(true));
    window.sysmonApi.menu.on('importXml', () => {
      // Trigger import via toolbar — dispatch a custom event the Toolbar listens to
      document.dispatchEvent(new CustomEvent('menu:importXml'));
    });
    window.sysmonApi.menu.on('openDatabase', () => {
      document.dispatchEvent(new CustomEvent('menu:openDatabase'));
    });

    return () => {
      window.sysmonApi.menu.removeAll('about');
      window.sysmonApi.menu.removeAll('documentation');
      window.sysmonApi.menu.removeAll('preferences');
      window.sysmonApi.menu.removeAll('importXml');
      window.sysmonApi.menu.removeAll('openDatabase');
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-surface-900 text-gray-100">
      {/* Toolbar */}
      <Toolbar onDataImported={handleDataImported} onOpenPreferences={() => setShowPreferences(true)} />

      {/* Tab bar */}
      <div className="flex border-b border-gray-700 bg-surface-800 px-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-accent-400 border-b-2 border-accent-400 bg-surface-900'
                : 'text-gray-400 hover:text-gray-200 hover:bg-surface-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden" key={refreshKey}>
        {activeTab === 'process' && <ProcessView />}
        {activeTab === 'map' && <MapView />}
        {activeTab === 'events' && <AllEventsView />}
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Dialogs */}
      {showPreferences && (
        <PreferencesDialog onClose={() => setShowPreferences(false)} />
      )}
      {showAbout && (
        <AboutDialog onClose={() => setShowAbout(false)} />
      )}
      {showDocs && (
        <DocumentationDialog onClose={() => setShowDocs(false)} />
      )}
    </div>
  );
}
