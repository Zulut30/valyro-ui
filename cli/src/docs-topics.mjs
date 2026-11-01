// Guides that are not components: what the MCP server's get_docs and search_components return for questions
// such as "headless hooks", "compound parts", "Tailwind", "React 17" or "React Native", and what llms.txt links.
// Shared by the CLI and scripts/registry/llms.mjs; the docs site has the long versions at `url`.

import { LIBRARY_PACKAGE, PRO_PACKAGE, SITE_URL } from './constants.mjs';

/** The Getting started guide is per framework; Vite stands in for "any React setup". */
const guide = (anchor) => `${SITE_URL}/#/getting-started/vite/${anchor}`;

export const DOCS_TOPICS = [
  {
    id: 'headless',
    title: 'Headless hooks (valyro-ui/headless)',
    url: `${SITE_URL}/#/getting-started/headless`,
    keywords: ['headless', 'hooks', 'behaviour', 'behavior', 'unstyled', 'primitives', 'usefloating', 'uselistnavigation', 'usefocustrap', 'usedismissablelayer', 'usevirtualizer', 'usecontrollablestate', 'usedisclosure', 'usepresence', 'usescrolllock', 'slot', 'portal', 'aschild'],
    text: [
      `\`${LIBRARY_PACKAGE}/headless\` (\`${PRO_PACKAGE}/headless\` in Pro) is the behaviour the components are built on, without markup or CSS: useControllableState, useDisclosure, useListNavigation (arrows, Home/End, type-ahead), useDismissableLayer (Escape and outside presses, one stack for every layer), useFocusTrap, useScrollLock, useFloating (position: fixed placement with flip and shift), usePresence (exit animations), useVirtualizer, Slot (asChild), Portal (into the nearest ThemeScope), mergeRefs, composeHandlers, useFlip, useSpringValue, useNow and the React 17–19 helpers (useId, useSyncExternalStore, useIsomorphicLayoutEffect, withRef, cleanupRef).`,
      'No stylesheet is needed; React 17, 18 and 19; ESM and CommonJS; call the hooks in Client Components.',
      'Installed as source with the CLI, the same hooks are in the `primitives` item (components/valyro-ui/primitives).',
    ].join('\n'),
  },
  {
    id: 'compound',
    title: 'Compound components (Dialog.Trigger, Tabs.List, …)',
    url: `${SITE_URL}/#/feedback/dialog/compound`,
    keywords: ['compound', 'parts', 'subcomponents', 'rsc', 'server components', 'dialog.trigger', 'tabs.list', 'card.header', 'datatable.row', 'select.item', 'dropdownmenu.item', 'treeview.item', 'formfield.label', 'combobox.item', 'radiogroup.item', 'listbox.item', 'checkboxgroup.item', 'checkboxtree.item', 'stepper.step', 'carousel.slide', 'calendar.grid', 'collapsible.trigger', 'togglegroup.item'],
    text: [
      'Card, Tabs, Accordion, Dialog, Drawer, BottomSheet, Select, MultiSelect, Combobox, CommandPalette, DropdownMenu, ContextMenu, Popover, HoverCard, Tooltip, Listbox, RadioGroup, CheckboxGroup, SegmentedControl, ChipGroup, FormField, Breadcrumbs, Sidebar, AppShell, ResizablePanels, Alert, Timeline, DataTable, TreeView, CheckboxTree, Stepper, Carousel, Collapsible, ToggleGroup and Calendar take props or parts: Card.Header/.Title/.Description/.Body/.Footer, Tabs.List/.Tab/.Panel, Accordion.Item/.Trigger/.Content, Dialog, Drawer and BottomSheet .Trigger/.Content/.Header/.Title/.Description/.Body/.Footer/.Close, Select, MultiSelect, Combobox and Listbox .Item/.Group (and .Empty), CommandPalette.Group/.Item, DropdownMenu and ContextMenu .Trigger/.Item/.CheckboxItem/.Label/.Separator, Popover, HoverCard and Tooltip .Trigger/.Content, RadioGroup, CheckboxGroup, SegmentedControl and ChipGroup .Item, FormField.Label/.Control/.Description/.Error, Breadcrumbs.Item, Sidebar.Section/.Item, AppShell.Header/.Sidebar/.Main/.Aside/.Footer, ResizablePanels.Panel/.Handle, Alert.Title/.Description/.Action, Timeline.Item, DataTable.Header/.Column/.Body/.Row/.Cell, TreeView.Item and CheckboxTree.Item (nested for branches), Stepper.Step, Carousel.Slide (a slide with its own thumbnail and name), Calendar.Header/.Previous/.Caption/.Next/.Grid (each month, in your order; Grid takes renderDay).',
      'Collection parts (tabs, options, rows) must be direct children of their parent part (fragments are fine) and render the same markup as the props, on the server too.',
      'Every part is also a named export (DialogTrigger, TabsTab, SelectItemPart, DataTableRow, …): use those in React Server Components, which cannot dot into a client component. get_component lists the parts of each component.',
    ].join('\n'),
  },
  {
    id: 'tailwind',
    title: 'Tailwind CSS v4',
    url: guide('tailwind'),
    keywords: ['tailwind', 'tailwindcss', 'utilities', 'utility', '@theme'],
    text: [
      `\`${LIBRARY_PACKAGE}/tailwind.css\` (source install: components/valyro-ui/styles/tailwind.css) is an \`@theme inline\` block that maps the --ui-* tokens onto Tailwind v4 utilities: bg-accent, text-fg, text-fg-muted, border-border, bg-surface, rounded-card, shadow-card, font-sans and more. They follow the active theme and mode, ThemeScope and Theme Builder exports; the dark: variant follows data-mode="dark".`,
      `Import order in the app CSS: @import 'tailwindcss'; then @import '${LIBRARY_PACKAGE}/styles.css'; then @import '${LIBRARY_PACKAGE}/tailwind.css'. Tailwind is not a dependency of the kit.`,
    ].join('\n'),
  },
  {
    id: 'react-versions',
    title: 'Supported React versions (17, 18, 19)',
    url: guide('react-versions'),
    keywords: ['react 17', 'react 18', 'react 19', 'react17', 'react18', 'react19', 'versions', 'version', 'compatibility', 'peer', 'jsx-runtime'],
    text: [
      'react and react-dom 17, 18 or 19 are peer dependencies; components, compound parts and the headless hooks behave the same on all three.',
      '- React 19: full, the primary target (ref as a prop, ref cleanups and the new DOM props natively).',
      '- React 18: full, through a small internal compatibility layer.',
      "- React 17: full, with two caveats: ids from useId are assigned right after mount (server HTML has none, so hydration matches); without a bundler, Node's native ESM loader cannot resolve React 17's react/jsx-runtime — require() the CommonJS build or use a bundler.",
    ].join('\n'),
  },
  {
    id: 'react-native',
    title: 'React Native (valyro-ui-native)',
    url: `${SITE_URL}/#/react-native`,
    keywords: ['react native', 'react-native', 'native', 'expo', 'ios', 'android', 'mobile', 'valyro-ui-native'],
    text: [
      '`valyro-ui-native`: 40+ accessible components built on React Native primitives (no native dependencies, works with Expo) with every ValyroUI theme in light and dark.',
      'Install: npx expo install valyro-ui-native (or npm install valyro-ui-native); wrap the app in its <ThemeProvider theme mode>; useTheme() gives the tokens; createTheme() builds a brand theme.',
    ].join('\n'),
  },
];

/** Topics whose title, id or keywords contain every word of `query` (or the whole query as one keyword). */
export function searchTopics(query) {
  const q = String(query ?? '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return DOCS_TOPICS.filter((topic) => {
    const haystack = [topic.id, topic.title, ...topic.keywords].join(' ').toLowerCase();
    return topic.keywords.includes(q) || words.every((word) => haystack.includes(word));
  });
}

/** A topic as text for a tool result. */
export const formatTopic = (topic) => `# ${topic.title}\n\n${topic.text}\n\nDocs: ${topic.url}`;
