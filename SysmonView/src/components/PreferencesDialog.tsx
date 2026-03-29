import { useEffect, useState } from 'react';

/**
 * Preferences Dialog — mirrors Delphi PreferencesUnit.
 * Accessed via Tools menu or Ctrl+Shift+P.
 * Manages API keys and provider settings.
 */

interface PreferencesDialogProps {
  onClose: () => void;
}

export default function PreferencesDialog({ onClose }: PreferencesDialogProps) {
  const [vtKey, setVtKey] = useState('');
  const [ipstackKey, setIpstackKey] = useState('');
  const [geoProvider, setGeoProvider] = useState<'ip-api' | 'ipstack'>('ip-api');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load current settings
  useEffect(() => {
    Promise.all([
      window.sysmonApi.vt.getKey(),
      window.sysmonApi.geoip.getKey(),
      window.sysmonApi.geoip.getProvider(),
    ]).then(([vt, ipstack, provider]) => {
      setVtKey(vt || '');
      setIpstackKey(ipstack || '');
      setGeoProvider(provider || 'ip-api');
      setLoaded(true);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await window.sysmonApi.vt.setKey(vtKey.trim());
    await window.sysmonApi.geoip.setKey(ipstackKey.trim());
    await window.sysmonApi.geoip.setProvider(geoProvider);
    setSaving(false);
    onClose();
  };

  if (!loaded) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
      <div className="bg-surface-800 border border-gray-600 rounded-lg shadow-2xl w-[480px] flex flex-col">
        {/* Title bar */}
        <div className="px-5 py-3 bg-surface-950 rounded-t-lg border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">Preferences</h2>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* API Keys group */}
          <fieldset className="border border-gray-700 rounded px-4 py-3">
            <legend className="text-xs text-gray-400 px-1">API Keys</legend>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-32 shrink-0 text-right">
                  VirusTotal Key
                </label>
                <input
                  type="password"
                  value={vtKey}
                  onChange={(e) => setVtKey(e.target.value)}
                  placeholder="Enter VirusTotal API key"
                  className="flex-1 px-2 py-1.5 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-32 shrink-0 text-right">
                  IPStack Key
                </label>
                <input
                  type="password"
                  value={ipstackKey}
                  onChange={(e) => setIpstackKey(e.target.value)}
                  placeholder="Enter IPStack API key (optional)"
                  className="flex-1 px-2 py-1.5 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </fieldset>

          {/* GeoIP Provider */}
          <fieldset className="border border-gray-700 rounded px-4 py-3">
            <legend className="text-xs text-gray-400 px-1">GeoIP Provider</legend>

            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 w-32 shrink-0 text-right">
                Provider
              </label>
              <select
                value={geoProvider}
                onChange={(e) => setGeoProvider(e.target.value as 'ip-api' | 'ipstack')}
                className="flex-1 px-2 py-1.5 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 focus:outline-none"
              >
                <option value="ip-api">ip-api.com (free, no key required)</option>
                <option value="ipstack">ipstack.com (requires API key)</option>
              </select>
            </div>
          </fieldset>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-surface-700 text-gray-300 rounded hover:bg-surface-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs bg-accent-600 text-white rounded hover:bg-accent-500 font-medium"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
