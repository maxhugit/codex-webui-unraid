/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path));

describe('Mergeron web and PWA identity', () => {
  it('uses the same name and theme in HTML and the install manifest', () => {
    const html = read('index.html').toString();
    const manifest = JSON.parse(read('public/manifest.webmanifest').toString());
    expect(html).toContain('<title>Mergeron</title>');
    expect(html).toContain('name="application-name" content="Mergeron"');
    expect(html).toContain(
      'name="apple-mobile-web-app-title" content="Mergeron"',
    );
    expect(html).not.toContain('Codex WebUI');
    expect(manifest.name).toBe('Mergeron');
    expect(manifest.short_name).toBe('Mergeron');
    expect(manifest.theme_color).toBe('#29282e');
    // Keep installed-app identity and launch URLs stable during the rebrand.
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('ships valid PNGs in all Apple and PWA sizes and a separate maskable icon', () => {
    for (const [name, size] of [
      ['pwa-icon-180.png', 180],
      ['pwa-icon-192.png', 192],
      ['pwa-icon-512.png', 512],
      ['pwa-icon-maskable-512.png', 512],
    ] as const) {
      const png = read(`public/${name}`);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    const manifest = JSON.parse(read('public/manifest.webmanifest').toString());
    expect(manifest.icons).toContainEqual(
      expect.objectContaining({
        src: '/pwa-icon-maskable-512.png',
        purpose: 'maskable',
      }),
    );
  });

  it('shares the graphite-copper vector artwork and invalidates old caches', () => {
    const master = read('public/mergeron-icon.svg').toString();
    expect(read('public/favicon.svg').toString()).toBe(master);
    expect(read('public/pwa-icon.svg').toString()).toBe(master);
    for (const color of ['#29282e', '#dfa071', '#fff9f0'])
      expect(master).toContain(color);
    const sw = read('public/sw.js').toString();
    expect(sw).toContain("'mergeron-static-v3'");
    expect(sw).toContain("'./pwa-icon-maskable-512.png'");
    expect(sw).toContain("'./mergeron-icon.svg'");
  });
});
