# ValyroUI

Free React components (React 17, 18 and 19) with plain CSS and CSS-variable themes: buttons, forms and date
pickers, navigation, dialogs and toasts, data tables, trees and basic charts. Docs and live demos:
**https://valyro.xyz**

This repository holds the free, MIT-licensed core of ValyroUI and its CLI. Pro components and themes are a
paid add-on ([pricing](https://valyro.xyz/#/pricing)) and are not part of this repository.

## What is here

| Path | What |
| --- | --- |
| `src/valyro-ui/` | Source of every free component, theme and shared helper, in the layout the installers copy into your project |
| `cli/` | `valyro-cli`: installs components as source, lists and searches them, sets up the MCP server for AI editors |

The code is maintained in the main ValyroUI repository and exported here, so this repository always matches
what the public registry at `https://valyro.xyz/r` serves.

## Install a component

With the shadcn CLI and the public registry:

```sh
npx shadcn@latest add https://valyro.xyz/r/button.json
```

The full list is in [`registry.json`](https://valyro.xyz/r/registry.json). Setup guides for Vite, Next.js,
Remix and other environments are on the [site](https://valyro.xyz/#/getting-started).

## Issues and contributions

Bug reports and ideas are welcome in [Issues](../../issues). Because this repository is generated, pull
requests are ported into the main repository by hand and then come back here with the next export.

## License

[MIT](LICENSE) for everything in this repository.
