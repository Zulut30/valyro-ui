<div align="center">

<a href="https://valyro.xyz"><img src="https://valyro.xyz/logo-mark.png" alt="ValyroUI" width="72" height="72"></a>

# ValyroUI

**React components in plain CSS, themed with one attribute.**

[![npm](https://img.shields.io/npm/v/valyro-ui?label=valyro-ui&color=4f46e5)](https://www.npmjs.com/package/valyro-ui)
[![CLI](https://img.shields.io/npm/v/valyro-cli?label=valyro-cli&color=4f46e5)](https://www.npmjs.com/package/valyro-cli)
[![React 17–19](https://img.shields.io/badge/React-17%20%7C%2018%20%7C%2019-149eca)](https://valyro.xyz/getting-started/)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

[Docs](https://valyro.xyz) · [Components](https://valyro.xyz/components/) · [Themes](https://valyro.xyz/themes/) · [Storybook](https://valyro.xyz/storybook/) · [Roadmap](https://valyro.xyz/roadmap/)

<a href="https://valyro.xyz"><img src="https://valyro.xyz/og-image.jpg" alt="ValyroUI components in several themes" width="760"></a>

</div>

This repository is the free, MIT-licensed core of ValyroUI and its CLI: 77 components — buttons, forms and date
pickers, navigation, dialogs and toasts, data tables, trees, timelines and basic charts — in the Vercel, Liquid Glass
and High Contrast themes, each with light, dark and right-to-left.

## Why ValyroUI

- **Themes are CSS variables.** Set `data-theme` on any element and mix themes on one page. Colours are OKLCH, and
  every theme passes WCAG AA contrast in light and dark mode under a test.
- **Accessible by default.** Keyboard, focus and ARIA patterns are built in, brought to the level of React Aria:
  type-ahead, live announcements, focus that returns where it came from. axe checks every Storybook story.
- **Headless when you need it.** `valyro-ui/headless` exports the hooks the components are built on (`useSelect`,
  `useCombobox`, `useTabs`, `useMenu`, `useDialog` and more): the same behaviour, your markup.
- **Compound parts.** `Dialog.Trigger`, `Tabs.List`, `Select.Item`… next to the props API, with named exports for
  React Server Components.
- **Renders on the server.** Every component renders to HTML from its props: Next.js App Router, React Router,
  Astro and TanStack Start pages arrive complete.
- **Light on the runtime.** No dependencies besides React. Animations run in CSS wherever the browser allows, and respect reduced motion.
- **Tailwind optional.** `valyro-ui/tailwind.css` turns every token into a Tailwind CSS v4 utility; without Tailwind
  nothing changes.

## Quick start

Install the package:

```sh
npm install valyro-ui
```

```tsx
import 'valyro-ui/styles.css';
import { Button, ThemeProvider } from 'valyro-ui';

export function App() {
  return (
    <ThemeProvider theme="vercel" mode="light">
      <Button variant="primary">Save</Button>
    </ThemeProvider>
  );
}
```

Or copy the components into your project as source, with their dependencies:

```sh
npx valyro-cli init          # styles, ThemeProvider and valyro.json; detects your framework
npx valyro-cli add button dialog data-table
```

The registry is shadcn-compatible too:

```sh
npx shadcn@latest add https://valyro.xyz/r/button.json
```

Step-by-step guides for Vite, Next.js, React Router 7, TanStack Start, Waku, Astro, Rsbuild, Parcel, Electron, Tauri
and Laravel + Inertia — and for using the same CSS in Vue, Nuxt, SvelteKit, Angular, SolidStart and plain HTML — are in
[Getting started](https://valyro.xyz/getting-started/).

## AI editors

`valyro-cli` ships an MCP server that lets Claude Code, Cursor, VS Code, Windsurf, Codex or OpenCode search the
catalog, read a component's source and docs, and install it:

```sh
npx valyro-cli mcp add claude-code     # or cursor, vscode, windsurf, codex, opencode
```

## What is in this repository

| Path | What |
| --- | --- |
| `src/valyro-ui/` | Source of every free component, theme and shared helper, in the layout the CLI copies into your project |
| `cli/` | `valyro-cli`: installs components as source, lists and searches them, sets up the MCP server for AI editors |

The code is maintained in the main ValyroUI repository and exported here, so this repository always matches what
the public registry at `https://valyro.xyz/r` serves.

## ValyroUI Pro

The free core covers the everyday interface. **ValyroUI Pro** adds the rest of the library — DataGrid, Scheduler,
Rich Text Editor, AI chat and agent UIs, image generation, node editor, advanced charts, effects and motion, commerce,
checkout, account, SaaS, editorial and gaming sets — and 16 more themes with their fonts. Pro sources are not in this
repository: see [pricing](https://valyro.xyz/pricing/).

## Issues and contributions

Bug reports and ideas are welcome in [Issues](../../issues). Because this repository is generated, pull requests are
ported into the main repository by hand and come back here with the next export.

## License

[MIT](LICENSE) for everything in this repository.
