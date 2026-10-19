# valyro-cli

Installs [ValyroUI](https://valyro.xyz) React components into your project as source code, with their dependencies. Node 20+, no runtime dependencies.

```sh
npx valyro-cli init                      # valyro.json + styles + ThemeProvider (add --patch to edit your entry file)
npx valyro-cli add button dialog data-table
npx valyro-cli list                      # or: search <query>, diff <name>
```

`init` detects Next.js, Vite, React Router, Astro, TanStack Start, Waku, Rsbuild, Parcel, electron-vite and Laravel + Inertia, the package manager and the tsconfig path alias. In Vue, Nuxt, Svelte(Kit), Angular and Solid(Start) projects it changes nothing and prints how to use the kit's CSS instead (the components are React). Files go to `src/components/valyro-ui/` (`app/…` for React Router, `components/…` for Next.js without `src/`). The Next.js Pages Router takes global CSS only from `pages/_app`, so there the components' stylesheet imports go into `components.css` in that folder, which `init --patch` imports in `_app`. `add` skips identical files, asks before replacing modified ones (`--overwrite` / `--yes` for scripts) and installs missing npm packages (`--skip-install` to only print the command). `--registry <url|dir>` uses another registry, e.g. a local `public/r`.

The registry is shadcn-compatible, so this also works without `init`:

```sh
npx shadcn@latest add https://valyro.xyz/r/button.json
```

## ValyroUI Pro

`list` and `search` mark Pro components and themes with `[Pro]`; the public registry has only their description, not the source. With a licence ([pricing](https://valyro.xyz/pricing/)):

```sh
npx valyro-cli login              # shows a one-time code and opens valyro.xyz to approve it
npx valyro-cli whoami             # account and plan
npx valyro-cli add data-grid      # Pro items now come from the licensed API
npx valyro-cli init --theme linear
npx valyro-cli logout             # revokes the token and deletes it
```

The token is stored in `~/.config/valyro/auth.json` (readable by you only) and sent only to `https://valyro.xyz/api`. Tokens are listed and revoked on the [account page](https://valyro.xyz/account/). In CI create a token there and use `valyro login --token <token>` or the `VALYRO_TOKEN` environment variable.

## MCP server

`valyro mcp` serves over stdio:

- component tools: `list_components`, `search_components`, `get_component` (source, docs, install command) and `get_install_command`; Pro items are marked and their source is returned only after `valyro login`;
- choosing and combining: `list_categories` and `review_composition`, which reads the planned components' source from the registry and flags effects overload, motion conflicts, missing reduced-motion handling, too many accents, mixed densities and weight;
- the ValyroUI agent skills (`skills/` in the repository, bundled into the package): one MCP prompt per skill, every skill file as a resource `valyro://skills/<id>/<file>`, and the tools `list_skills`, `get_skill` and `install_skill` (copies skills into `.claude/skills/`; previews first and never replaces a changed file unless asked);
- theme tools: `create_site_theme` builds a theme that matches a client's site with `createThemeCSS` (from brand values, the site's CSS or wishes in words), checks WCAG AA contrast in light and dark, fixes what fails and returns the CSS with preview links; `tune_components` lists the public tokens of chosen components and writes overrides for just those components. They read the URLs you pass as text only and write nothing.

Add it to your AI client (merges the `valyro` entry into the client's config, keeps the rest, backs the file up):

```sh
npx valyro-cli mcp add claude-code     # or cursor, vscode, windsurf, codex, opencode
npx valyro-cli mcp add cursor --print  # only show the config
```

`--scope project|user` picks the project's file or the one in your home folder (default per client). `--hosted` uses the hosted server `https://valyro.xyz/api/mcp` instead (the registry tools, no local process; it needs a token: committed project files read it from `VALYRO_TOKEN`, VS Code asks for it).

By hand, Claude Code: `claude mcp add valyro -- npx -y valyro-cli@latest mcp`; Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "valyro": { "command": "npx", "args": ["-y", "valyro-cli@latest", "mcp"] } } }
```

Run it from your project directory, or pass `--cwd <dir>` / `--registry <url|dir>`.

MIT licensed.
