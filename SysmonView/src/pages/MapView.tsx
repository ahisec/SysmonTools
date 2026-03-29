import { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import EventDetailPanel from '../components/EventDetailPanel';
import TermsDialog from '../components/TermsDialog';

/**
 * Map View tab — mirrors Delphi TabSheetMapView.
 *
 * Displays a choropleth world map where countries are colored based on
 * the number of network connections destined to them (from NetworkConnectionDetected).
 *
 * Delphi implementation:
 *   - TeeChart TWorldSeries colored countries orange with Z-value = connection count
 *   - Click a country → bottom panel shows all connections to that country
 *
 * Our implementation:
 *   - Leaflet + GeoJSON choropleth (country polygons colored by traffic volume)
 *   - Click a country → bottom panel with connection details grid
 *   - Dark tile layer to match the app theme
 */

// ─── ISO alpha-2 → alpha-3 mapping ─────────────────────────────────────────────
// The database stores 2-letter codes (from ipstack), GeoJSON uses 3-letter codes.

const ISO2_TO_ISO3: Record<string, string> = {
  AF:'AFG',AL:'ALB',DZ:'DZA',AS:'ASM',AD:'AND',AO:'AGO',AG:'ATG',AR:'ARG',AM:'ARM',
  AU:'AUS',AT:'AUT',AZ:'AZE',BS:'BHS',BH:'BHR',BD:'BGD',BB:'BRB',BY:'BLR',BE:'BEL',
  BZ:'BLZ',BJ:'BEN',BT:'BTN',BO:'BOL',BA:'BIH',BW:'BWA',BR:'BRA',BN:'BRN',BG:'BGR',
  BF:'BFA',BI:'BDI',KH:'KHM',CM:'CMR',CA:'CAN',CV:'CPV',CF:'CAF',TD:'TCD',CL:'CHL',
  CN:'CHN',CO:'COL',KM:'COM',CG:'COG',CD:'COD',CR:'CRI',CI:'CIV',HR:'HRV',CU:'CUB',
  CY:'CYP',CZ:'CZE',DK:'DNK',DJ:'DJI',DM:'DMA',DO:'DOM',EC:'ECU',EG:'EGY',SV:'SLV',
  GQ:'GNQ',ER:'ERI',EE:'EST',ET:'ETH',FJ:'FJI',FI:'FIN',FR:'FRA',GA:'GAB',GM:'GMB',
  GE:'GEO',DE:'DEU',GH:'GHA',GR:'GRC',GD:'GRD',GT:'GTM',GN:'GIN',GW:'GNB',GY:'GUY',
  HT:'HTI',HN:'HND',HU:'HUN',IS:'ISL',IN:'IND',ID:'IDN',IR:'IRN',IQ:'IRQ',IE:'IRL',
  IL:'ISR',IT:'ITA',JM:'JAM',JP:'JPN',JO:'JOR',KZ:'KAZ',KE:'KEN',KI:'KIR',KP:'PRK',
  KR:'KOR',KW:'KWT',KG:'KGZ',LA:'LAO',LV:'LVA',LB:'LBN',LS:'LSO',LR:'LBR',LY:'LBY',
  LI:'LIE',LT:'LTU',LU:'LUX',MK:'MKD',MG:'MDG',MW:'MWI',MY:'MYS',MV:'MDV',ML:'MLI',
  MT:'MLT',MH:'MHL',MR:'MRT',MU:'MUS',MX:'MEX',FM:'FSM',MD:'MDA',MC:'MCO',MN:'MNG',
  ME:'MNE',MA:'MAR',MZ:'MOZ',MM:'MMR',NA:'NAM',NR:'NRU',NP:'NPL',NL:'NLD',NZ:'NZL',
  NI:'NIC',NE:'NER',NG:'NGA',NO:'NOR',OM:'OMN',PK:'PAK',PW:'PLW',PA:'PAN',PG:'PNG',
  PY:'PRY',PE:'PER',PH:'PHL',PL:'POL',PT:'PRT',QA:'QAT',RO:'ROU',RU:'RUS',RW:'RWA',
  KN:'KNA',LC:'LCA',VC:'VCT',WS:'WSM',SM:'SMR',ST:'STP',SA:'SAU',SN:'SEN',RS:'SRB',
  SC:'SYC',SL:'SLE',SG:'SGP',SK:'SVK',SI:'SVN',SB:'SLB',SO:'SOM',ZA:'ZAF',SS:'SSD',
  ES:'ESP',LK:'LKA',SD:'SDN',SR:'SUR',SZ:'SWZ',SE:'SWE',CH:'CHE',SY:'SYR',TW:'TWN',
  TJ:'TJK',TZ:'TZA',TH:'THA',TL:'TLS',TG:'TGO',TO:'TON',TT:'TTO',TN:'TUN',TR:'TUR',
  TM:'TKM',TV:'TUV',UG:'UGA',UA:'UKR',AE:'ARE',GB:'GBR',US:'USA',UY:'URY',UZ:'UZB',
  VU:'VUT',VE:'VEN',VN:'VNM',YE:'YEM',ZM:'ZMB',ZW:'ZWE',PS:'PSE',XK:'XKX',
};

interface CountryTraffic {
  DestinationCountryCode: string;
  Count: number;
}

interface ConnectionRow {
  FID: number;
  UtcTime: string;
  ProcessGuid: string;
  Image: string;
  User: string;
  Protocol: string;
  Initiated: number;
  SourceIp: string;
  SourcePort: string;
  SourceCountry: string;
  DestinationIp: string;
  DestinationPort: string;
  DestinationHostname: string;
  DestinationCountry: string;
  DestinationCountryCode: string;
  Computer: string;
  RuleName: string;
}

export default function MapView() {
  const [countryData, setCountryData] = useState<Record<string, number>>({});
  const [geoJson, setGeoJson] = useState<any>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCountryName, setSelectedCountryName] = useState<string>('');
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [totalConnections, setTotalConnections] = useState(0);
  const [loading, setLoading] = useState(true);
  const geoJsonRef = useRef<L.GeoJSON | null>(null);

  // GeoIP enrichment state
  const [provider, setProvider] = useState<GeoProvider>('ip-api');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [geoProgress, setGeoProgress] = useState<{ current: number; total: number; ip?: string } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapVersion, setMapVersion] = useState(0); // bump to reload map data
  const [detailWindows, setDetailWindows] = useState<{ eventType: number; gid: number; key: number }[]>([]);
  const [topZ, setTopZ] = useState(50);
  const [windowZ, setWindowZ] = useState<Record<number, number>>({});
  const [showGeoTerms, setShowGeoTerms] = useState(false);
  const pendingResolveRef = useRef(false);

  // Load saved settings
  useEffect(() => {
    window.sysmonApi.geoip.getProvider().then(setProvider);
    window.sysmonApi.geoip.getKey().then((key) => {
      if (key) setApiKey(key);
    });
  }, []);

  // Listen for GeoIP progress
  useEffect(() => {
    window.sysmonApi.geoip.onProgress((progress) => {
      if (progress.status === 'resolving') {
        setGeoProgress({ current: progress.current, total: progress.total, ip: progress.currentIp });
      } else if (progress.status === 'done') {
        setResolving(false);
        setGeoProgress(null);
        setMapVersion((v) => v + 1); // reload map data
      } else if (progress.status === 'error') {
        setResolving(false);
        setGeoProgress(null);
        setGeoError(progress.error || 'Unknown error');
      }
    });
    return () => { window.sysmonApi.geoip.removeProgressListener(); };
  }, []);

  // Load country traffic counts from DB
  useEffect(() => {
    setLoading(true);
    window.sysmonApi.db
      .query(
        `SELECT DestinationCountryCode, COUNT(DestinationCountryCode) AS Count
         FROM NetworkConnectionDetected
         WHERE DestinationCountryCode <> 'n/a' AND DestinationCountryCode <> ''
         GROUP BY DestinationCountryCode`
      )
      .then((rows: any[]) => {
        const map: Record<string, number> = {};
        let total = 0;
        for (const row of rows as CountryTraffic[]) {
          const iso3 = ISO2_TO_ISO3[row.DestinationCountryCode.toUpperCase()];
          if (iso3) {
            map[iso3] = (map[iso3] || 0) + row.Count;
            total += row.Count;
          }
        }
        setCountryData(map);
        setTotalConnections(total);
      })
      .catch(() => setCountryData({}))
      .finally(() => setLoading(false));
  }, [mapVersion]);

  // Load GeoJSON — use relative path so it works with both Vite dev server and
  // Electron production (file:// protocol where absolute '/' doesn't resolve)
  useEffect(() => {
    fetch('./countries.geojson')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setGeoJson)
      .catch((err) => {
        console.error('Failed to load GeoJSON:', err);
        setGeoJson(null);
      });
  }, []);

  // When a country is clicked, load its connections
  const onCountryClick = useCallback((countryCode2: string, countryName: string) => {
    setSelectedCountry(countryCode2);
    setSelectedCountryName(countryName);
    window.sysmonApi.db
      .query(
        'SELECT * FROM NetworkConnectionDetected WHERE UPPER(DestinationCountryCode) = UPPER(?)',
        [countryCode2]
      )
      .then((rows: any[]) => setConnections(rows as ConnectionRow[]))
      .catch(() => setConnections([]));
  }, []);

  // Style each country polygon
  const countryStyle = useCallback(
    (feature: any) => {
      const iso3 = feature.id;
      const count = countryData[iso3] || 0;
      const hasTraffic = count > 0;

      // Color intensity based on connection count (log scale)
      let fillColor = '#1a1f2e'; // dark default
      let fillOpacity = 0.7;
      if (hasTraffic) {
        const maxCount = Math.max(...Object.values(countryData), 1);
        const intensity = Math.log(count + 1) / Math.log(maxCount + 1);
        // Gradient from dark orange to bright orange
        const r = Math.round(150 + intensity * 105);
        const g = Math.round(40 + intensity * 62);
        const b = Math.round(10 + intensity * 35);
        fillColor = `rgb(${r}, ${g}, ${b})`;
        fillOpacity = 0.8;
      }

      return {
        fillColor,
        fillOpacity,
        color: '#2d3748', // border
        weight: 0.5,
        opacity: 0.8,
      };
    },
    [countryData]
  );

  // Attach click + hover handlers to each country
  const onEachFeature = useCallback(
    (feature: any, layer: L.Layer) => {
      const iso3 = feature.id;
      const name = feature.properties?.name || iso3;
      const count = countryData[iso3] || 0;

      // Find the 2-letter code for this country
      const iso2 = Object.entries(ISO2_TO_ISO3).find(([, v]) => v === iso3)?.[0] || '';

      // Tooltip
      layer.bindTooltip(
        `<strong>${name}</strong>${count > 0 ? `<br/>${count} connection${count !== 1 ? 's' : ''}` : ''}`,
        { sticky: true, className: 'map-tooltip' }
      );

      // Click handler
      (layer as L.Path).on('click', () => {
        if (count > 0 && iso2) {
          onCountryClick(iso2, name);
        }
      });

      // Hover highlight
      (layer as L.Path).on('mouseover', () => {
        (layer as L.Path).setStyle({ weight: 2, color: '#e5e7eb', fillOpacity: 0.9 });
      });
      (layer as L.Path).on('mouseout', () => {
        if (geoJsonRef.current) {
          geoJsonRef.current.resetStyle(layer as L.Path);
        }
      });
    },
    [countryData, onCountryClick]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading map data...
      </div>
    );
  }

  const hasData = Object.keys(countryData).length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="px-3 py-2 text-xs bg-surface-800 border-b border-gray-700 flex items-center justify-between shrink-0 gap-3">
        <span className="text-gray-400">
          {hasData
            ? `${totalConnections.toLocaleString()} network connections across ${Object.keys(countryData).length} countries`
            : 'No country data yet. Use "Resolve GeoIP" to enrich IP addresses with location data.'}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {/* GeoIP progress */}
          {resolving && geoProgress && (
            <span className="text-blue-400">
              Resolving {geoProgress.current}/{geoProgress.total} — {geoProgress.ip}
            </span>
          )}

          {/* Error message */}
          {geoError && (
            <span className="text-red-400 max-w-[300px] truncate" title={geoError}>
              {geoError}
              <button onClick={() => setGeoError(null)} className="ml-1 text-gray-500 hover:text-white">×</button>
            </span>
          )}

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-2 py-1 text-xs bg-surface-700 text-gray-400 rounded hover:bg-surface-600 hover:text-gray-200"
          >
            Settings
          </button>

          {/* Provider selector + API key (toggled) */}
          {showSettings && (
            <>
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as GeoProvider;
                  setProvider(p);
                  window.sysmonApi.geoip.setProvider(p);
                }}
                className="px-2 py-1 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 focus:outline-none"
              >
                <option value="ip-api">ip-api.com (free, no key)</option>
                <option value="ipstack">ipstack.com (key required)</option>
              </select>

              {provider === 'ipstack' && (
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={() => {
                    if (apiKey) window.sysmonApi.geoip.setKey(apiKey);
                  }}
                  placeholder="ipstack API key"
                  className="px-2 py-1 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 w-44 focus:outline-none focus:border-blue-500"
                />
              )}
            </>
          )}

          {/* Resolve button */}
          <button
            onClick={async () => {
              if (provider === 'ipstack' && !apiKey) {
                setShowSettings(true);
                setGeoError('Please enter your ipstack.com API key first');
                return;
              }

              // Check T&C acceptance
              const tosKey = provider === 'ip-api' ? 'acceptedIpApiToS' : 'acceptedIpStackToS';
              const accepted = await window.sysmonApi.settings.get(tosKey);
              if (accepted !== 'true') {
                pendingResolveRef.current = true;
                setShowGeoTerms(true);
                return;
              }

              setGeoError(null);
              setResolving(true);
              if (provider === 'ipstack') await window.sysmonApi.geoip.setKey(apiKey);
              try {
                await window.sysmonApi.geoip.resolve(provider, apiKey);
              } catch (err: any) {
                setGeoError(err.message);
                setResolving(false);
              }
            }}
            disabled={resolving}
            className={`px-3 py-1 text-xs rounded font-medium ${
              resolving
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-orange-600 text-white hover:bg-orange-500'
            }`}
          >
            {resolving ? 'Resolving...' : 'Resolve GeoIP'}
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {geoJson ? (
          <MapContainer
            center={[20, 0]}
            zoom={2}
            minZoom={2}
            maxZoom={7}
            style={{ height: '100%', width: '100%', background: '#0f1320' }}
            worldCopyJump={true}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
            />
            <GeoJSON
              ref={(ref) => { geoJsonRef.current = ref; }}
              key={JSON.stringify(countryData)}
              data={geoJson}
              style={countryStyle}
              onEachFeature={onEachFeature}
            />
          </MapContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading map...
          </div>
        )}
      </div>

      {/* Bottom panel: Connection details for selected country */}
      {selectedCountry && (
        <div className="h-64 border-t border-gray-700 flex flex-col bg-surface-800 shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface-950 border-b border-gray-700">
            <span className="text-xs font-semibold text-gray-300">
              {selectedCountryName} — {connections.length} connection{connections.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => { setSelectedCountry(null); setConnections([]); }}
              className="text-gray-400 hover:text-white text-sm px-2"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-950 sticky top-0">
                <tr>
                  {['UTC Time', 'Image', 'Protocol', 'Source IP', 'Src Port',
                    'Dest IP', 'Dest Port', 'Dest Hostname', 'User', 'Computer'].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-gray-400 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {connections.map((c, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-800 hover:bg-surface-700 cursor-pointer"
                    onDoubleClick={() => {
                      const key = Date.now() + i;
                      setDetailWindows((prev) => [...prev, { eventType: 3, gid: c.FID, key }]);
                      setTopZ((z) => z + 1);
                      setWindowZ((prev) => ({ ...prev, [key]: topZ + 1 }));
                    }}
                  >
                    <td className="px-3 py-1 text-gray-300 whitespace-nowrap">{c.UtcTime}</td>
                    <td className="px-3 py-1 text-gray-300 font-mono text-[11px] max-w-[200px] truncate">{c.Image}</td>
                    <td className="px-3 py-1 text-gray-300">{c.Protocol}</td>
                    <td className="px-3 py-1 text-gray-300 font-mono">{c.SourceIp}</td>
                    <td className="px-3 py-1 text-gray-300">{c.SourcePort}</td>
                    <td className="px-3 py-1 text-gray-300 font-mono">{c.DestinationIp}</td>
                    <td className="px-3 py-1 text-gray-300">{c.DestinationPort}</td>
                    <td className="px-3 py-1 text-gray-300 max-w-[200px] truncate">{c.DestinationHostname}</td>
                    <td className="px-3 py-1 text-gray-300 max-w-[150px] truncate">{c.User}</td>
                    <td className="px-3 py-1 text-gray-300">{c.Computer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showGeoTerms && (
        <TermsDialog
          serviceName={provider === 'ip-api' ? 'ip-api.com' : 'ipstack.com'}
          termsUrl={provider === 'ip-api' ? 'https://ip-api.com/docs/legal' : 'https://ipstack.com/terms'}
          onAccept={async () => {
            const tosKey = provider === 'ip-api' ? 'acceptedIpApiToS' : 'acceptedIpStackToS';
            await window.sysmonApi.settings.set(tosKey, 'true');
            setShowGeoTerms(false);
            if (pendingResolveRef.current) {
              pendingResolveRef.current = false;
              setGeoError(null);
              setResolving(true);
              if (provider === 'ipstack') await window.sysmonApi.geoip.setKey(apiKey);
              try {
                await window.sysmonApi.geoip.resolve(provider, apiKey);
              } catch (err: any) {
                setGeoError(err.message);
                setResolving(false);
              }
            }
          }}
          onCancel={() => {
            setShowGeoTerms(false);
            pendingResolveRef.current = false;
          }}
        />
      )}

      {detailWindows.map((dw, i) => (
        <EventDetailPanel
          key={dw.key}
          eventType={dw.eventType}
          gid={dw.gid}
          index={i}
          zIndex={windowZ[dw.key] ?? 50}
          onFocus={() => {
            setTopZ((z) => z + 1);
            setWindowZ((prev) => ({ ...prev, [dw.key]: topZ + 1 }));
          }}
          onClose={() => setDetailWindows((prev) => prev.filter((w) => w.key !== dw.key))}
        />
      ))}
    </div>
  );
}
