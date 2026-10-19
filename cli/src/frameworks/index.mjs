// Framework adapters for `valyro init`: one module per framework, registered below.
//
// Adding a framework (cli/test/frameworks.test.mjs fails until every step is done):
//  1. Guide: append { id, name, summary, steps } to `frameworkGuides` in src/docs/guides/frameworks.ts.
//  2. Adapter: create cli/src/frameworks/<name>.mjs from the closest existing one (vite.mjs: client
//     entry with <App />; next.mjs or react-router.mjs: SSR root that renders <html>; nuxt.mjs:
//     CSS-only). Set `guide` to the guide id, then add it to ADAPTERS at its place in the detection
//     order. If `init` cannot set the framework up (no package.json, detected as another framework),
//     add the guide id to MANUAL_ONLY_GUIDES with the reason instead.
//  3. Fixture: add a minimal project for the adapter (package.json deps + entry file) to FIXTURES in
//     cli/test/frameworks.test.mjs.
//  4. React frameworks (adapter kind 'react' or a manual-only guide of kind 'react'): in
//     src/docs/framework-usage.ts add a FRAMEWORKS entry whose guideIds include the guide id, a
//     STYLE_ENTRY for it, and a usageSnippets() case if `src/Example.tsx` is the wrong place.
//  5. npm test.

import angular from './angular.mjs';
import astro from './astro.mjs';
import electronVite from './electron-vite.mjs';
import laravelInertia from './laravel-inertia.mjs';
import next from './next.mjs';
import nuxt from './nuxt.mjs';
import parcel from './parcel.mjs';
import reactRouter from './react-router.mjs';
import rsbuild from './rsbuild.mjs';
import solid from './solid.mjs';
import solidStart from './solid-start.mjs';
import svelte from './svelte.mjs';
import sveltekit from './sveltekit.mjs';
import tanstackStart from './tanstack-start.mjs';
import vite from './vite.mjs';
import vue from './vue.mjs';
import waku from './waku.mjs';

/**
 * @typedef {{ rsc: boolean, defaultDir: string }} Detection
 *
 * @typedef {object} PatchData How `init --patch` wires a React framework's entry file (see setupPlan()).
 * @property {string[]} entries Entry file candidates; the first existing one is patched, the first one is named when none exists.
 * @property {RegExp | null} anchor Global regexp for the element wrapped in <ThemeProvider>; must match exactly once.
 * @property {string} [wrapped] The anchor as written in the printed snippet (default `<App />`).
 * @property {boolean} [ssr] The entry renders <html>: the theme attributes go on it.
 * @property {boolean} [islands] React renders only in islands (Astro): no provider, just the CSS import and <html> attributes.
 * @property {(base: string, file: string, index: number) => string} [cssImport] Replaces `import '<base>/<file>';` for each
 *   stylesheet (index 0: `styles/index.css`, 1: an opt-in `styles/themes/<name>.css`).
 * @property {(index: number) => string} [headLink] Added to the `links: [` of head() per stylesheet (TanStack Start).
 * @property {(values: { attrs: string, provider: string }) => string} [note] Printed after patching or with the snippet.
 *
 * @typedef {object} ManualSteps What `init` prints for a CSS-only framework (see cssOnlySteps()).
 * @property {string} label
 * @property {[string, string]} css File and line that import the stylesheet.
 * @property {[string, string]} theme File and line that set the theme; `{attrs}`, `{theme}` and `{mode}` are filled in.
 * @property {string} [note]
 *
 * @typedef {object} Adapter
 * @property {string} name Stored as "framework" in valyro.json.
 * @property {string} guide Guide id in src/docs/guides/frameworks.ts.
 * @property {'react' | 'css'} kind react: `init` copies the components and patches the entry; css: it prints manual steps.
 * @property {(dir: string, deps: Record<string, string>) => Detection | null} detect deps: dependencies and devDependencies.
 * @property {PatchData | ((config: { rsc: boolean }, projectDir: string) => PatchData)} [patch] kind 'react'.
 * @property {ManualSteps} [manual] kind 'css'.
 */

/**
 * Detection order: the first adapter whose detect() matches wins. Meta-frameworks come before the
 * bundlers they run on (Next/React Router/TanStack before Vite, Nuxt before Vue, SvelteKit before
 * Svelte, SolidStart before Solid), and CSS-only frameworks before Rsbuild/Parcel/Vite, so a Vue app
 * on Vite is Vue. Astro comes before the CSS-only ones: an Astro site with a Vue integration is Astro.
 * @type {Adapter[]}
 */
export const ADAPTERS = [
  next,
  astro,
  waku,
  tanstackStart,
  reactRouter,
  laravelInertia,
  electronVite,
  nuxt,
  sveltekit,
  svelte,
  angular,
  solidStart,
  solid,
  vue,
  rsbuild,
  parcel,
  vite,
];

/**
 * Guides in src/docs/guides/frameworks.ts with no adapter: `init` either cannot set them up or
 * already does through another adapter. kind 'react' guides still need a usage snippet in the docs;
 * 'native' is for non-web platforms (no CSS, no React).
 * @type {{ guide: string, kind: 'react' | 'css' | 'native', reason: string }[]}
 */
export const MANUAL_ONLY_GUIDES = [
  { guide: 'html', kind: 'css', reason: 'No framework to detect or entry to patch: the page links the ValyroUI stylesheet and uses static markup.' },
  { guide: 'tauri', kind: 'react', reason: 'The Tauri frontend is a plain Vite + React app: `init` detects it as vite and patches src/main.tsx.' },
  { guide: 'php', kind: 'css', reason: 'A Composer package (php/), not an npm project: the PHP renderer and the ValyroUI stylesheet replace the React components.' },
  { guide: 'wordpress', kind: 'css', reason: 'Installed as a WordPress plugin zip (npm run build:wp); there is no project entry for the CLI to patch.' },
  { guide: 'swiftui', kind: 'native', reason: 'A Swift package (swift/, product KitUI) added through Xcode or Package.swift; no npm project or CSS to patch.' },
];

export const adapterByName = (name) => ADAPTERS.find((adapter) => adapter.name === name);
