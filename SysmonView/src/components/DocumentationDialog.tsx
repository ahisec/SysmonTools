/**
 * Documentation dialog — displays help information about Sysmon View.
 */
interface DocumentationDialogProps {
  onClose: () => void;
}

export default function DocumentationDialog({ onClose }: DocumentationDialogProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-800 border border-gray-700 rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-white">Documentation</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-gray-300 space-y-4">
          <section>
            <h3 className="text-white font-semibold mb-1">Getting Started</h3>
            <p>
              Sysmon View helps you analyze Windows Sysmon event logs visually.
              Start by importing one or more Sysmon XML log files using
              <span className="text-gray-200 font-medium"> File &gt; Import XML Logs </span>
              or the <span className="text-gray-200 font-medium">Import XML</span> toolbar button.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-1">Process View</h3>
            <p>
              The main analysis view. Select an executable from the left panel to see
              its image paths, process sessions (GUIDs), and the signature
              <span className="text-gray-200 font-medium"> Session Diagram</span> — a
              color-coded chain of events showing what a process did during its lifetime.
            </p>
            <ul className="list-disc list-inside mt-1 text-xs text-gray-400 space-y-0.5">
              <li>Use the filter box to search for specific processes</li>
              <li>Double-click a diagram node to view full event details</li>
              <li>Enable <span className="text-gray-300">Pin Mode</span> to pin important events for focused analysis</li>
              <li>Use <span className="text-gray-300">Show pinned only</span> with context events for compact views</li>
            </ul>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-1">All Events</h3>
            <p>
              A paginated grid of all imported Sysmon events. Supports:
            </p>
            <ul className="list-disc list-inside mt-1 text-xs text-gray-400 space-y-0.5">
              <li>Drag column headers to the group zone to create hierarchical groupings</li>
              <li>Text filter to search across all columns</li>
              <li>Column sorting by clicking headers</li>
              <li>Double-click a row to view full event details</li>
            </ul>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-1">Map View</h3>
            <p>
              Visualizes network connections on a world map after GeoIP enrichment.
              Use <span className="text-gray-200 font-medium">Resolve GeoIP</span> to
              enrich IP addresses with country data.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-1">VirusTotal Integration</h3>
            <p>
              Hash fields (MD5, SHA1, SHA256, IMPHASH) and IP addresses in event
              details have two options:
            </p>
            <ul className="list-disc list-inside mt-1 text-xs text-gray-400 space-y-0.5">
              <li><span className="text-gray-300">VT Report</span> — opens the VirusTotal page directly in your browser (no API key needed)</li>
              <li><span className="text-gray-300">VT</span> button — performs an inline API lookup showing detection counts (requires a free VT API key)</li>
            </ul>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-1">Keyboard Shortcuts</h3>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div><kbd className="text-gray-300 bg-surface-700 px-1 rounded">Ctrl+I</kbd> Import XML logs</div>
              <div><kbd className="text-gray-300 bg-surface-700 px-1 rounded">Ctrl+O</kbd> Open database</div>
              <div><kbd className="text-gray-300 bg-surface-700 px-1 rounded">Ctrl+,</kbd> Preferences</div>
              <div><kbd className="text-gray-300 bg-surface-700 px-1 rounded">F1</kbd> Documentation</div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-surface-900 border-t border-gray-700 flex justify-center shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-1.5 text-xs bg-accent-600 text-white rounded hover:bg-accent-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
