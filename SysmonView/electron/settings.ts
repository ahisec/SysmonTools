import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Shared settings persistence — simple JSON file in user data directory.
 * Stores API keys, provider choices, and T&C acceptance flags.
 */

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Record<string, string> {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch {}
  return {};
}

export function saveSettings(settings: Record<string, string>): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

export function getSetting(key: string): string {
  return loadSettings()[key] || '';
}

export function setSetting(key: string, value: string): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}
