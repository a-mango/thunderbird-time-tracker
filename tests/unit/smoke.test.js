import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = new URL('../../src/', import.meta.url).pathname;

/** @param {string} dir @returns {Promise<string[]>} */
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

const manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8'));
const messages = JSON.parse(await readFile(join(srcDir, '_locales/en/messages.json'), 'utf8'));

describe('manifest', () => {
  it('is MV3 with an event-page module background', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ scripts: ['background/main.js'], type: 'module' });
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe('157.0');
  });

  it('requests no permissions in M0', () => {
    expect(manifest.permissions ?? []).toEqual([]);
    expect(manifest.host_permissions ?? []).toEqual([]);
  });

  it('shows the action in every space and declares both commands', () => {
    expect(manifest.action.allowed_spaces).toEqual([]);
    expect(Object.keys(manifest.commands).sort()).toEqual(['_execute_action', 'toggle-timer']);
  });

  it('references only existing locale messages and files', async () => {
    const keys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(messages, key).toHaveProperty(key);
    const files = [...manifest.background.scripts, manifest.action.default_popup];
    const present = (await listFiles(srcDir)).map((f) => relative(srcDir, f));
    for (const file of files) expect(present).toContain(file);
  });
});

describe('shipped sources', () => {
  it('never reference the dev harness or unsafe HTML sinks', async () => {
    const files = (await listFiles(srcDir)).filter((f) => /\.(js|html|css|json)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/["'/]dev\//);
      expect(text, file).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b|\beval\(/);
    }
  });

  it('use only data-i18n keys that exist', async () => {
    const pages = (await listFiles(srcDir)).filter((f) => f.endsWith('.html'));
    for (const page of pages) {
      const html = await readFile(page, 'utf8');
      for (const [, key] of html.matchAll(/data-i18n="(\w+)"/g))
        expect(messages, page).toHaveProperty(key);
    }
  });
});
