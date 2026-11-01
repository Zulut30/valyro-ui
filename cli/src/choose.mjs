// "Which control for this job?" for the MCP servers: a decision table distilled from 50 UI libraries
// (shadcn, React Aria, Material 3, Apple HIG, Carbon, Polaris, MUI X, Naive, Element Plus, Ionic, …).
// Each job names the kit component to pick, when to switch to another one, and the common wrong
// choice. Component ids are checked against the registry by the tests and against the live index at
// run time; thresholds marked "about" are starting points, not rules from a single source.

/** `pick` and `to` are component ids; `missing` describes a canon the kit lacks and what to compose instead. */
export const CHOICES = [
  {
    id: 'one-of-few-instant',
    job: 'Pick one of 2–5 short options that apply at once (a mode, a view)',
    keywords: ['mode', 'view switch', 'toggle view', 'one of few', 'режим', 'переключател'],
    pick: ['segmented-control'],
    switchTo: [{ when: 'labels are long, options need a description, more than about 5, or the value is submitted with a form later', to: ['radio-group'] }],
    wrong: 'tabs or a dropdown menu holding a value; a pair of switches',
  },
  {
    id: 'one-of-few-form',
    job: 'Pick one of 2–7 options in a form',
    keywords: ['radio', 'choose one', 'single choice', 'option', 'plan', 'один из', 'выбор одного', 'радио'],
    pick: ['radio-group'],
    switchTo: [{ when: 'more than about 7 options, or little space', to: ['select'] }],
    wrong: 'checkboxes for an exclusive choice; a select for two options',
  },
  {
    id: 'one-of-many',
    job: 'Pick one value from a long list (countries, users, products)',
    keywords: ['select', 'dropdown', 'choose from list', 'country', 'many options', 'long list', 'выпадающ', 'спис', 'стран', 'выбор из', 'pick a', 'users', 'user', 'выбрать пользовател'],
    pick: ['select'],
    switchTo: [
      { when: 'the user knows what to type, or more than about 15 options', to: ['combobox'] },
      { when: 'the options come from the server', to: ['combobox'], note: 'remote search with debounce, loading, no-results and error states, no client filtering' },
    ],
    wrong: 'a dropdown menu (it is for commands); a select of 200 items without typeahead',
  },
  {
    id: 'one-visible',
    job: 'Pick one, with the list always visible on the page',
    keywords: ['listbox', 'visible list', 'master list', 'список на странице'],
    pick: ['listbox'],
    switchTo: [{ when: 'the list is long and space is scarce', to: ['select'] }],
    wrong: 'a radio group of 30 items',
  },
  {
    id: 'many-of-few',
    job: 'Pick several from a short visible set',
    keywords: ['checkboxes', 'multiple', 'several', 'filters toggle', 'чекбокс', 'нескольк', 'множеств'],
    pick: ['checkbox-group', 'chip-group'],
    switchTo: [{ when: 'more than about 7 options', to: ['multi-select'] }],
    wrong: 'a multi-select for three options; loose checkboxes without a group label',
  },
  {
    id: 'many-of-many',
    job: 'Pick several from a large closed set',
    keywords: ['multi select', 'multiselect', 'assign', 'many values', 'мультиселект', 'много значени', 'назнач'],
    pick: ['multi-select'],
    switchTo: [{ when: 'moving items from a big pool to a target list', to: ['listbox'], note: 'a transfer list is not in the kit: two listboxes with move buttons' }],
    wrong: 'a tags input (typos create junk values)',
  },
  {
    id: 'free-values',
    job: 'Enter free-form values (labels, emails, keywords)',
    keywords: ['tags', 'labels', 'emails', 'keywords', 'free values', 'теги', 'тегов', 'метк', 'ключев'],
    pick: ['tags-input'],
    switchTo: [
      { when: 'values must come from a fixed list', to: ['multi-select'] },
      { when: '@mentions inside prose', to: ['mentions-input'] },
    ],
    wrong: 'a textarea with commas',
  },
  {
    id: 'hierarchy-pick',
    job: 'Pick from a hierarchy (folders, categories, org units)',
    keywords: ['tree', 'hierarchy', 'nested', 'folders', 'categories', 'дерев', 'иерархи', 'вложенн', 'папк'],
    pick: ['checkbox-tree', 'tree-view'],
    switchTo: [
      { when: 'inside a form field', to: ['combobox', 'tree-view'], note: 'a tree select is not in the kit: a combobox opening a tree view' },
      { when: 'a path through uniform levels (country, region, city)', to: ['select'], note: 'a cascader is not in the kit: chained selects' },
    ],
    wrong: 'a select with indented options; nested accordions',
  },
  {
    id: 'commands',
    job: 'Run a command on an object (row actions, overflow menu)',
    keywords: ['actions', 'commands', 'menu', 'row actions', 'overflow', 'more', 'действи', 'команд', 'меню', 'троеточ'],
    pick: ['dropdown-menu', 'icon-button'],
    switchTo: [
      { when: 'one default action plus alternatives', to: ['button-group', 'dropdown-menu'], note: 'a split button' },
      { when: 'right-click as a second path', to: ['context-menu'] },
      { when: 'on phones', to: ['bottom-sheet'], note: 'an action list of at most 4 actions' },
    ],
    wrong: 'a select for actions; a tab bar that runs actions',
  },
  {
    id: 'jump-anywhere',
    job: 'Jump anywhere or run any action (⌘K)',
    keywords: ['command palette', 'cmd k', 'spotlight', 'search everything', 'quick open', 'палитра команд', 'поиск по всему', 'быстрый поиск'],
    pick: ['command-palette'],
    switchTo: [
      { when: 'searching one list only', to: ['search-input'] },
      { when: 'picking a field value', to: ['combobox'] },
    ],
    wrong: 'the palette as the only path to an action',
  },
  {
    id: 'sections',
    job: 'Move between sections of one page or object',
    keywords: ['tabs', 'sections', 'switch panels', 'вкладк', 'раздел', 'табы'],
    pick: ['tabs'],
    switchTo: [
      { when: 'more than 6 sections, or app-level areas', to: ['sidebar'], note: 'at most two levels' },
      { when: 'showing where you are in a depth', to: ['breadcrumbs'] },
    ],
    wrong: 'a segmented control for navigation; tabs wrapping onto two rows',
  },
  {
    id: 'mobile-nav',
    job: 'Top-level navigation on phones',
    keywords: ['bottom navigation', 'tab bar', 'mobile navigation', 'phone nav', 'навигаци', 'мобильн', 'нижняя панель', 'таббар'],
    pick: ['floating-tab-bar'],
    switchTo: [{ when: 'more than 5 destinations', to: ['sidebar', 'drawer'], note: 'a sidebar inside a drawer' }],
    wrong: 'a hamburger menu for three sections',
    missing: 'a floating action button for the main create action: an icon-button placed inside the safe area',
  },
  {
    id: 'filter',
    job: 'Filter a list or catalogue',
    keywords: ['filter', 'filters', 'facets', 'refine', 'фильтр', 'фасет', 'отбор'],
    pick: ['filter-toolbar', 'search-input'],
    switchTo: [
      { when: 'nested AND/OR conditions', to: ['filter-builder'] },
      { when: 'shop facets', to: ['product-filters'] },
      { when: 'on phones', to: ['drawer', 'bottom-sheet'] },
    ],
    wrong: 'a modal for a few filters on desktop; filters that are not in the URL',
  },
  {
    id: 'date',
    job: 'Enter a planned date',
    keywords: ['date', 'calendar', 'deadline', 'дата', 'дату', 'даты', 'календар', 'срок', 'birthday', 'birth date', 'рождени'],
    pick: ['date-picker'],
    switchTo: [
      { when: 'typing is faster (power users)', to: ['date-field'] },
      { when: 'a date the person knows by heart (birthday, document)', to: ['date-of-birth-input'] },
      { when: 'on phones', to: ['wheel-picker'] },
    ],
    wrong: 'a calendar for a birth date; plain text without a format',
  },
  {
    id: 'date-range',
    job: 'Enter a date range',
    keywords: ['date range', 'period', 'from to', 'range', 'диапазон', 'период'],
    pick: ['date-range-picker'],
    switchTo: [{ when: 'live analytics', to: ['date-range-picker'], note: 'relative ranges ("last 15 minutes"), presets, auto-refresh, and a second range for comparison' }],
    wrong: 'two unrelated date pickers',
  },
  {
    id: 'time',
    job: 'Enter a time',
    keywords: ['time', 'hour', 'время', 'времени', 'часы'],
    pick: ['time-field'],
    switchTo: [
      { when: 'picking from fixed slots', to: ['select', 'booking-slots'] },
      { when: 'touch screens', to: ['time-picker'] },
    ],
    wrong: 'a free text field',
  },
  {
    id: 'number',
    job: 'Enter a number or an amount of money',
    keywords: ['number', 'amount', 'money', 'price', 'quantity', 'числ', 'сумм', 'деньг', 'денег', 'цена', 'цену', 'цены', 'количеств'],
    pick: ['number-input'],
    switchTo: [
      { when: 'an approximate value in a bounded range', to: ['slider'] },
      { when: 'a price range filter', to: ['histogram-range'] },
      { when: 'card numbers, phone numbers, patterned IDs', to: ['card-input', 'phone-input', 'masked-input'] },
    ],
    wrong: 'type="number" for money, phone, ZIP or codes; a slider for an exact value',
  },
  {
    id: 'upload',
    job: 'Upload files',
    keywords: ['upload', 'file', 'attachment', 'drop zone', 'загрузить', 'загрузка файл', 'файл', 'вложени', 'avatar', 'аватар', 'загрузк'],
    pick: ['file-uploader'],
    switchTo: [],
    wrong: 'a bare file input with no list, progress or limits',
  },
  {
    id: 'progress',
    job: 'Show the progress of a long task',
    keywords: ['progress', 'loading', 'long task', 'wait', 'pending', 'прогресс', 'ожидани', 'долгая операция', 'долгой операци', 'загрузк', 'показать загрузк'],
    pick: ['progress-bar'],
    switchTo: [
      { when: 'unknown and short (under about 5 s)', to: ['spinner'], note: 'after a short delay' },
      { when: 'content is loading', to: ['skeleton'] },
      { when: 'a staged pipeline', to: ['stepper', 'generation-progress'] },
      { when: 'a background job', to: ['toast'], note: 'one toast updated in place' },
      { when: 'the page must wait', to: ['loading-overlay'] },
    ],
    wrong: 'a full-screen overlay for a background task; a spinner that flashes on fast loads',
  },
  {
    id: 'status',
    job: 'Show the status of an item',
    keywords: ['status', 'state badge', 'lifecycle', 'статус', 'состояни'],
    pick: ['badge'],
    switchTo: [],
    wrong: 'colour-only dots; a "Status:" prefix; animating final states',
  },
  {
    id: 'destructive',
    job: 'Confirm a destructive action',
    keywords: ['delete', 'remove', 'destroy', 'confirm', 'danger', 'удал', 'подтвержд', 'опасн'],
    pick: ['confirm-dialog'],
    switchTo: [
      { when: 'irreversible and high impact', to: ['confirm-dialog'], note: 'make the user type the resource name' },
      { when: 'the action can be undone', to: ['toast'], note: 'act at once and offer Undo' },
      { when: 'low risk, inline', to: ['popover'], note: 'a popconfirm with two buttons' },
    ],
    wrong: 'window.confirm; confirming reversible actions; OK and Cancel labels; the delete button styled as primary',
  },
  {
    id: 'feedback',
    job: 'Give feedback after an action',
    keywords: ['feedback', 'saved', 'success message', 'notify', 'сохранен', 'успех', 'обратная связь'],
    pick: ['toast'],
    switchTo: [
      { when: 'the user must act or the problem persists', to: ['alert'] },
      { when: 'one field is wrong', to: ['form-field'], note: 'the error at the field' },
    ],
    wrong: 'toasts for validation errors; a toast as the only record of something important',
  },
  {
    id: 'explain',
    job: 'Explain a control or a term',
    keywords: ['tooltip', 'help', 'explain', 'hint', 'info', 'подсказк', 'помощ', 'пояснени', 'объясн'],
    pick: ['tooltip'],
    switchTo: [
      { when: 'it must be read on touch, or holds links', to: ['popover'], note: 'a toggletip behind an "i" button' },
      { when: 'a preview of an entity', to: ['hover-card'] },
    ],
    wrong: 'interactive content in a tooltip; critical information only on hover',
  },
  {
    id: 'compare',
    job: 'Compare items, plans or versions',
    keywords: ['compare', 'comparison', 'versus', 'plans', 'сравн', 'тариф'],
    pick: ['compare-tray'],
    switchTo: [
      { when: 'plans or tiers', to: ['comparison-table', 'pricing-table'] },
      { when: 'before and after media', to: ['image-compare'] },
    ],
    wrong: 'side-by-side cards whose rows do not line up',
  },
  {
    id: 'table-small',
    job: 'Show tabular data, small and read-mostly',
    keywords: ['table', 'list of records', 'rows', 'таблиц', 'запис', 'строк'],
    pick: ['data-table'],
    switchTo: [
      { when: 'the fields of one record', to: ['description-list'] },
      { when: 'large, editable, grouped or server-side data', to: ['data-grid'] },
    ],
    wrong: 'a data grid for five static rows',
  },
  {
    id: 'table-large',
    job: 'Show tabular data, large or editable',
    keywords: ['data grid', 'spreadsheet', 'editable table', 'virtualized', 'big table', 'грид', 'большая таблица', 'редактируем'],
    pick: ['data-grid'],
    switchTo: [{ when: 'more than a page of about 100 rows, or data on the server', to: ['data-grid'], note: 'server mode: sort, filter and page through one data source' }],
    wrong: 'a data table with 10k client rows; editing each row in a modal',
  },
  {
    id: 'onboarding',
    job: 'Onboard a new user',
    keywords: ['onboarding', 'getting started', 'welcome', 'tour', 'онбординг', 'знакомств', 'приветстви', 'тур'],
    pick: ['onboarding-checklist'],
    switchTo: [
      { when: 'orienting in a new interface', to: ['tour'], note: 'few steps, skippable, resumable' },
      { when: 'one new feature', to: ['popover'], note: 'a coachmark' },
    ],
    wrong: 'a long tour that starts on its own at launch',
  },
  {
    id: 'empty',
    job: 'Show that there is nothing here',
    keywords: ['empty', 'no data', 'no results', 'nothing', 'пуст', 'нет данных', 'ничего не найден', 'пустой', 'пустая', 'пустое'],
    pick: ['empty-state'],
    switchTo: [],
    wrong: 'a blank table; one message for both "no data yet" and "no results"',
    note: 'type it: first run, no data, no results (with Clear filters), error, no access; at most two actions',
  },
  {
    id: 'details',
    job: 'Show details or side content',
    keywords: ['details', 'side panel', 'drawer', 'master detail', 'preview', 'детал', 'боковая панель', 'подробн'],
    pick: ['drawer'],
    switchTo: [
      { when: 'a short focused task', to: ['dialog'] },
      { when: 'a wide master-detail layout', to: ['resizable-panels'] },
      { when: 'on phones', to: ['bottom-sheet'] },
    ],
    wrong: 'a dialog over a dialog; a drawer for a two-field confirmation',
  },
  {
    id: 'notifications',
    job: 'Keep a record of notifications',
    keywords: ['notifications', 'inbox', 'bell', 'alerts center', 'уведомлени', 'колокольч', 'входящ'],
    pick: ['notification-center'],
    switchTo: [
      { when: 'the change history of one record', to: ['activity-feed'] },
      { when: 'a passing result', to: ['toast'] },
    ],
    wrong: 'an endless stack of toasts as the inbox',
  },
  {
    id: 'rich-text',
    job: 'Write formatted text',
    keywords: ['rich text', 'editor', 'wysiwyg', 'formatting', 'markdown', 'редактор', 'форматир', 'текст'],
    pick: ['rich-text-editor'],
    switchTo: [
      { when: 'plain text', to: ['textarea'] },
      { when: 'plain text with @mentions', to: ['mentions-input'] },
      { when: 'Markdown source', to: ['textarea', 'markdown-preview'] },
    ],
    wrong: 'a home-made contenteditable; a rich editor for one-line comments',
  },
  {
    id: 'rating',
    job: 'Rate something',
    keywords: ['rating', 'stars', 'score', 'nps', 'рейтинг', 'звёзд', 'звезд', 'оценк'],
    pick: ['rating-input'],
    switchTo: [{ when: 'a labelled scale (NPS 0–10, agree/disagree)', to: ['segmented-control', 'radio-group'] }],
    wrong: 'clickable star spans with no radio semantics',
  },
  {
    id: 'long-form',
    job: 'Fill a long form with dependent steps',
    keywords: ['wizard', 'steps', 'multi step', 'checkout flow', 'long form', 'мастер', 'шаги', 'шагов', 'пошагов', 'длинная форма'],
    pick: ['multi-step-form'],
    switchTo: [
      { when: 'one or two steps, or independent sections', to: ['form-field'], note: 'one form with fieldsets' },
      { when: 'independent settings', to: ['settings-panel'] },
    ],
    wrong: 'a stepper used as navigation between unrelated settings',
    note: 'about 3–7 steps, validation per step, a review before submit',
  },
  {
    id: 'on-off',
    job: 'Turn a setting on or off',
    keywords: ['switch', 'toggle', 'on off', 'enable', 'включ', 'выключ', 'переключ', 'тумблер', 'включить', 'выключить'],
    pick: ['switch'],
    switchTo: [
      { when: 'the value is submitted with a form', to: ['checkbox'] },
      { when: 'a pressed state in a toolbar', to: ['toggle'] },
    ],
    wrong: 'a switch inside a form with a Save button',
  },
  {
    id: 'colour',
    job: 'Pick a colour',
    keywords: ['color', 'colour', 'swatch', 'palette', 'цвет', 'палитр'],
    pick: ['swatch-picker'],
    switchTo: [{ when: 'any colour is allowed', to: ['color-picker'] }],
    wrong: 'a free picker for a brand-limited choice',
  },
];

/** The job for an id, or the best keyword matches for words (stems of 4+ letters match word starts). */
export function matchChoice({ job, need = '' } = {}) {
  if (job) return CHOICES.filter((c) => c.id === job);
  const words = (value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  const text = ` ${words(need)} `;
  const has = (k) => text.includes(` ${words(k)}${k.length >= 4 ? '' : ' '}`);
  const scored = CHOICES.map((c) => ({ c, score: c.keywords.reduce((n, k) => n + (has(k) ? k.length : 0), 0) })).filter((x) => x.score);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score >= best * 0.6).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.c);
}

/**
 * `index`: the live registry index, for tiers and for names this registry does not have. `missing` words that case:
 * the free hosted registry does not list Pro items, so a name it lacks may be one.
 */
export function formatChoices(choices, index, { missing = 'not in this registry' } = {}) {
  const byName = new Map(index.map((item) => [item.name, item]));
  const tag = (name) => (byName.has(name) ? `${name}${byName.get(name).pro ? ' (Pro)' : ''}` : `${name} (${missing})`);
  const names = (list) => list.map(tag).join(' + ');
  const blocks = choices.map((c) =>
    [
      `## ${c.job} (\`${c.id}\`)`,
      '',
      `Pick: ${names(c.pick)}${c.note ? ` — ${c.note}` : ''}`,
      ...c.switchTo.map((s) => `Switch to ${names(s.to)} when ${s.when}${s.note ? ` (${s.note})` : ''}`),
      `Wrong choice: ${c.wrong}`,
      ...(c.missing ? [`Not in the kit: ${c.missing}`] : []),
    ].join('\n'),
  );
  const pro = choices.some((c) => [...c.pick, ...c.switchTo.flatMap((s) => s.to)].some((n) => byName.get(n)?.pro));
  return [
    ...blocks,
    `Next: get_component with includeSource false for the props, then get_install_command. ${pro ? '(Pro) items need a ValyroUI Pro licence; name a free alternative. ' : ''}Thresholds with "about" are starting points: the user's data and device decide.`,
  ].join('\n\n');
}
