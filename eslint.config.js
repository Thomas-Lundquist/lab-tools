/**
 * ESLint flat config (v9) — token guard.
 *
 * Single purpose: fail the lint on raw Tailwind color utilities so tool markup
 * cannot bypass the semantic token layer (--color-*) and re-fragment the UI.
 * See design system convergence: every color must flow through a token, e.g.
 * `text-[var(--color-text-muted)]`, never `text-gray-500`.
 *
 * This is intentionally NOT a full React lint preset — a broader ruleset would
 * flood the report with unrelated findings and bury the migration worklist.
 * (React/a11y linting is reserved for a separate pass; eslint-plugin-react is
 * installed but not wired here yet.)
 *
 * While the per-tool convergence is in progress `npm run lint` is expected to
 * fail: its error count is the burndown meter, dropping to 0 when done.
 */

// Utilities that carry color, and the raw Tailwind palette names that bypass
// the token layer. `-[0-9]` requires the numeric shade (e.g. gray-500), so
// arbitrary-value classes like text-[var(--color-…)] are never matched.
const COLOR_PREFIX = 'bg|text|border|ring|from|to|via|divide|placeholder|fill|stroke|outline|decoration|ring-offset'
const RAW_PALETTE =
  'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const RAW_COLOR = `(${COLOR_PREFIX})-(${RAW_PALETTE})-[0-9]`

const MESSAGE =
  'Raw Tailwind color class bypasses the design tokens. Use a semantic token, ' +
  'e.g. text-[var(--color-text-muted)] / bg-[var(--color-bg-surface)] / ' +
  'border-[var(--color-border)] — see src/styles/global.css.'

// The named-palette rule above only catches shade-numbered classes, which is how
// a large body of hardcoded hex accumulated undetected inside arbitrary values
// (`bg-[#B7102A]`). Those are the same bypass wearing a different hat.
const ARBITRARY_HEX = `(${COLOR_PREFIX})-\\[#[0-9a-fA-F]{3,8}\\]`

const ARBITRARY_HEX_MESSAGE =
  'Hardcoded hex in an arbitrary Tailwind value bypasses the design tokens and ' +
  'will not respond to the theme switch. Use border-[var(--color-border)] and ' +
  'friends — see src/styles/global.css.'

// A bare hex is almost always an inline style or a JS color constant
// (style={{ borderColor: '#d1d5db' }}), the other way color escaped the tokens.
// Deliberately NOT anchored: the shape that actually ships hardcoded color is a
// hex inside a longer declaration -- style={{ border: '1px solid #d1d5db' }} --
// where the property name is a separate AST node, so an anchored pattern sees
// only '1px solid #d1d5db' and misses it. Lengths are pinned to real hex
// notations, longest first, so DOM id strings ('#app') and href anchors ('#top')
// do not trip it.
const BARE_HEX = '#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b'

const BARE_HEX_MESSAGE =
  'Hardcoded hex color. Inline styles must read a token, e.g. ' +
  "style={{ borderColor: 'var(--color-border)' }}. The only sanctioned exception " +
  'is markup that renders outside our CSS cascade — injected Canvas markup, shadow ' +
  'DOM, or a sandboxed iframe — where no custom property is readable. Disable this ' +
  'rule inline and say which applies.'

import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Registered so existing `// eslint-disable-line react-hooks/*` directives
    // resolve; the rules themselves are intentionally left off for now (a real
    // hooks-lint pass is a separate task, kept out of the token-guard signal).
    plugins: { 'react-hooks': reactHooks },
    // With the hooks rules off, those pre-existing disable directives read as
    // "unused" — silence that so the report shows only token violations. A
    // proper react-hooks pass will re-enable the rules (tracked separately).
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-syntax': [
        'error',
        // Static className strings: className="… text-gray-500 …"
        { selector: `Literal[value=/${RAW_COLOR}/]`, message: MESSAGE },
        // Template-literal className: className={`… ${x} border-gray-200`}
        { selector: `TemplateElement[value.cooked=/${RAW_COLOR}/]`, message: MESSAGE },
        // Arbitrary hex value: className="border-[#d1d5db]"
        { selector: `Literal[value=/${ARBITRARY_HEX}/]`, message: ARBITRARY_HEX_MESSAGE },
        { selector: `TemplateElement[value.cooked=/${ARBITRARY_HEX}/]`, message: ARBITRARY_HEX_MESSAGE },
        // Bare hex anywhere: style={{ color: '#ef4444' }}, const RED = '#B7102A'
        { selector: `Literal[value=/${BARE_HEX}/]`, message: BARE_HEX_MESSAGE },
        { selector: `TemplateElement[value.cooked=/${BARE_HEX}/]`, message: BARE_HEX_MESSAGE },
      ],
    },
  },
]
