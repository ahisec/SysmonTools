import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Database } from './database';
import { importSysmonXml } from './xml-importer';
import { resolveGeoIp, getApiKey, setApiKey, getProvider, setProvider, type GeoProvider } from './geoip';
import { getVtApiKey, setVtApiKey, lookupHash, lookupIp } from './virustotal';
import { getSetting, setSetting } from './settings';

let mainWindow: BrowserWindow | null = null;
let db: Database | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 600,
    title: 'Sysmon View',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load from Vite dev server; in production, load the built file
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Initialize database in user data directory
  const dbPath = path.join(app.getPath('userData'), 'sysmonview.db');
  db = new Database(dbPath);
  await db.initialize();

  registerIpcHandlers();
  createWindow();
  setupMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) {
    db.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ─── Application Menu ─────────────────────────────────────────────────────────

const GITHUB_URL = 'https://github.com/nshalabi/SysmonTools';

function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import XML Logs...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu:importXml'),
        },
        {
          label: 'Open Database...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:openDatabase'),
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:preferences'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send('menu:documentation'),
        },
        { type: 'separator' },
        {
          label: 'Learn More',
          click: () => shell.openExternal(GITHUB_URL),
        },
        {
          label: 'Search Issues',
          click: () => shell.openExternal(`${GITHUB_URL}/issues`),
        },
        {
          label: 'Support the Project',
          click: () => shell.openExternal(`${GITHUB_URL}/stargazers`),
        },
        { type: 'separator' },
        {
          label: 'About Sysmon View',
          click: () => mainWindow?.webContents.send('menu:about'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────
// These bridge the renderer (React UI) to the main process (SQLite, file system)

function registerIpcHandlers() {
  // Database: run a query and return rows
  ipcMain.handle('db:query', (_event, sql: string, params?: unknown[]) => {
    if (!db) throw new Error('Database not initialized');
    return db.query(sql, params);
  });

  // Database: execute a statement (INSERT, UPDATE, DELETE)
  ipcMain.handle('db:execute', (_event, sql: string, params?: unknown[]) => {
    if (!db) throw new Error('Database not initialized');
    return db.execute(sql, params);
  });

  // Database: run multiple statements in a transaction
  ipcMain.handle('db:executeMany', (_event, statements: { sql: string; params?: unknown[] }[]) => {
    if (!db) throw new Error('Database not initialized');
    return db.executeMany(statements);
  });

  // Database: check if data exists
  ipcMain.handle('db:hasData', () => {
    if (!db) throw new Error('Database not initialized');
    return db.hasData();
  });

  // Database: clear all data
  ipcMain.handle('db:clearAll', () => {
    if (!db) throw new Error('Database not initialized');
    return db.clearAll();
  });

  // File dialog: open XML file(s)
  ipcMain.handle('dialog:openXmlFiles', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Sysmon XML Logs',
      filters: [
        { name: 'XML Files', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    return result.filePaths;
  });

  // File dialog: open database file
  ipcMain.handle('dialog:openDatabase', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Sysmon View Database',
      filters: [
        { name: 'SQLite Database', extensions: ['db', 'sqlite'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.filePaths[0] || null;
  });

  // Switch to a different database file
  ipcMain.handle('db:openFile', async (_event, filePath: string) => {
    if (db) db.close();
    db = new Database(filePath);
    await db.initialize();
    return true;
  });

  // Get the current database path
  ipcMain.handle('db:getPath', () => {
    return db?.getPath() ?? null;
  });

  // Import Sysmon XML file(s)
  ipcMain.handle('import:xmlFiles', async (_event, filePaths: string[]) => {
    if (!db) throw new Error('Database not initialized');
    let totalEvents = 0;

    for (const filePath of filePaths) {
      const count = await importSysmonXml(db, filePath, (progress) => {
        // Send progress updates to the renderer
        mainWindow?.webContents.send('import:progress', progress);
      });
      totalEvents += count;
    }

    return totalEvents;
  });

  // GeoIP: get saved API key
  ipcMain.handle('geoip:getKey', () => {
    return getApiKey();
  });

  // GeoIP: save API key
  ipcMain.handle('geoip:setKey', (_event, key: string) => {
    setApiKey(key);
  });

  // GeoIP: get/set provider
  ipcMain.handle('geoip:getProvider', () => {
    return getProvider();
  });

  ipcMain.handle('geoip:setProvider', (_event, provider: GeoProvider) => {
    setProvider(provider);
  });

  // GeoIP: resolve IPs to countries
  ipcMain.handle('geoip:resolve', async (_event, provider: GeoProvider, apiKey: string) => {
    if (!db) throw new Error('Database not initialized');
    return resolveGeoIp(db, provider, apiKey, (progress) => {
      mainWindow?.webContents.send('geoip:progress', progress);
    });
  });

  // VirusTotal: get/set API key
  ipcMain.handle('vt:getKey', () => getVtApiKey());
  ipcMain.handle('vt:setKey', (_event, key: string) => setVtApiKey(key));

  // VirusTotal: on-demand hash lookup
  ipcMain.handle('vt:lookup', async (_event, apiKey: string, hash: string) => {
    return lookupHash(apiKey, hash);
  });

  // VirusTotal: on-demand IP lookup
  ipcMain.handle('vt:lookupIp', async (_event, apiKey: string, ip: string) => {
    return lookupIp(apiKey, ip);
  });

  // Settings: generic get/set for T&C acceptance flags etc.
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key));
  ipcMain.handle('settings:set', (_event, key: string, value: string) => setSetting(key, value));

  // Shell: open URL in default browser
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url));

}
