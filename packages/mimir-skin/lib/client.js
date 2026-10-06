/* Generated from client.mjs and Tools/mimir-tokens.json by Tools/build-mimir-skin.mjs — do not edit by hand. */
// A breadcrumb the page can be asked about later: it records that this bundle was
// requested and whether its factory ran. `loaded` true with `applied` false means the
// factory threw — and the throw is re-raised so it stays loud in the console too.
window.__MIMIR_SKIN__ = { loaded: true, applied: false, error: "" };
(function () {
try {
window.__ModuleLoader__.load({
	id: "dsh-mimir-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/* The vault's palette, read from Tools/mimir-tokens.json at build time. */
		const MIMIR = {"light":{"paper":"#faf6ea","paper-2":"#f2ead6","paper-3":"#e9dfc6","canvas":"#fbfaf6","ink":"#25231d","ink-2":"#5d5749","ink-3":"#665e4c","rule":"#e3d9c1","rule-soft":"#eadfc8","line":"#c9bc9e","mark":"#4f7a5c","mark-soft":"#dbe8d4","mint":"#2f7d63","peach":"#b5642f","peach-soft":"#f4e7d6","cyan":"#2c6b7a"},"dark":{"paper":"#06070d","paper-2":"#0b0e18","paper-3":"#121724","canvas":"#eaf6fb","ink":"#dbeaf2","ink-2":"#9db8c6","ink-3":"#7f9dad","rule":"#182031","rule-soft":"#1e2739","line":"#2a3550","mark":"#8fd6a4","mark-soft":"#1e3830","mint":"#a6e3bd","peach":"#f0b183","peach-soft":"#33261d","cyan":"#95d7de"}}

		/**
		 * The Mimir skin, browser half.
		 *
		 * WHY A SKIN AND NOT A WINDOW. The Lesson window was an application standing beside the
		 * conversation: a floating panel with its own lifecycle, its own pointer to a session it
		 * did not own, its own host half, and a file protocol between the two. Every fault it
		 * produced — the dock that was never added, the route that answered 405 because the web
		 * carrier had not mounted yet, the preference that did not survive a reload, the answer
		 * that was recorded but never delivered — was a property of that architecture, and each
		 * one cost an evening. A skin has no lifecycle. It occupies nothing, replaces nothing,
		 * holds no state, and cannot lose a message. So the lesson surface moves into the chat
		 * itself, beginning with the chat wearing the vault's own clothes.
		 *
		 * HOW IT REACHES THE PAGE. `ctx.theme.overrideTokens(source, tokens)` stacks a token
		 * layer over whatever theme is active — the token-level analogue of slot shading. The
		 * layout presenter folds that layer into the active theme and writes every resulting
		 * variable as an inline custom property on `<body>`, so an override beats the base
		 * stylesheet without touching it, and removing the layer restores exactly what it
		 * covered. Light and dark ride in one call: a layer maps each token name to a
		 * `{ light, dark }` pair and the presenter picks the half that matches the active
		 * colour scheme. That is why this half never asks which scheme is on.
		 *
		 * WHY `inject: ['theme']` AND NOT A GUARD. The pane's host half lost a launch to a race:
		 * it read its carrier, found it absent, and returned — permanently and silently. On this
		 * plane the equivalent mistake is guarded against by the composition itself: naming
		 * `theme` in `inject` means this plugin does not apply until that service exists, so
		 * there is no "not ready yet" branch to get wrong.
		 *
		 * WHAT IT DOES, IN TWO TIERS. The first is INK: a token layer, which registers no slot,
		 * occupies no node and replaces no component, so it cannot break the layout — it can only
		 * be illegible, and legibility is checked rather than hoped for. The second is the BOARD:
		 * one conversation row, keyed to the `mimir_board` tool, drawn in the same design so the
		 * lesson's spine, question, hint and drawings sit inline in the chat where the teaching
		 * happened, instead of in a window beside it. There is still no window, no pointer, no
		 * outbox and no state file — the row is a pure function of the tool call the session
		 * already carries.
		 *
		 * THE PALETTE REACHES THE STYLESHEET THE SAME WAY IT REACHES THE PRODUCT. `tokensFor`
		 * emits both the product's `--dsw-*` names and this skin's own `--mm-*` ones into the one
		 * override layer, and the presenter writes them all onto `<body>` as inline custom
		 * properties. So the board's stylesheet reads `var(--mm-paper)` and switches light and
		 * dark for free, because the layer already carries a value per scheme — and there is still
		 * exactly one source in the vault for a colour.
		 *
		 * `MIMIR` IS SUPPLIED BY THE BUILD. The palette lives in `Tools/mimir-tokens.json` and
		 * nowhere else; `Tools/build-mimir-skin.mjs` reads it and prepends it to this file as a
		 * `const MIMIR`. Nothing here hard-codes a colour, so a change to the palette reaches the
		 * app through a rebuild and cannot drift from the theme, the chart generator or the pane.
		 *
		 * @module dsh-mimir-skin/client
		 */

		const React = require("react")
		const { createRoot } = require("react-dom/client")
		/**
		 * The live theme facade while the skin is on, or null while it is off.
		 *
		 * MODULE SCOPE, NOT AN INJECTED PROP, and the reason is that a control reading through a
		 * prop is a control that disappears silently if the prop never arrives: the component
		 * returns nothing, no error is raised, and the button is simply not there. `engage` sets
		 * this; `disengage` clears it; the header control reads it. The slot's `inject` still wins
		 * when it is honoured, so nothing is lost where the product does deliver it.
		 */
		let activeTheme = null

		/**
		 * Record a failure somewhere the interface can be asked about.
		 *
		 * The bundle's breadcrumb already answers "did this load and is it on"; this adds "and what
		 * went wrong", because a seat that failed to register is otherwise indistinguishable from a
		 * seat that was never asked for.
		 *
		 * @param message - what failed, in one line.
		 */
		function note(message) {
		  if (typeof window === 'undefined' || window.__MIMIR_SKIN__ === undefined) return
		  window.__MIMIR_SKIN__.error = message
		}

		/** The layer's identity. One layer per source: re-applying replaces this one entirely. */
		const SOURCE = 'mimir-skin'

		/**
		 * The two faces, taken from the vault theme rather than invented here.
		 *
		 * The rule they carry is the whole of Mimir's typography: a serif for everything that is
		 * *read* — the teacher's prose, quotations, headings — and a blocky monospace for
		 * everything that is *furniture*: labels, buttons, counts, tool rows, metadata. The pane
		 * had the same pair spelled `--mimir-serif` and `--mimir-mono`.
		 */
		const SERIF =
		  '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, "Times New Roman", serif'
		const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Menlo, monospace'

		/**
		 * Build the token layer from the vault's palette.
		 *
		 * Held as a function of the palette rather than a literal so the build can supply the
		 * same object the theme and the chart generator read, and so a test can call it without
		 * a browser.
		 *
		 * @param palette - `Tools/mimir-tokens.json`: `{ light: {...}, dark: {...} }`.
		 * @returns token-name → `{ light, dark }`, the shape `overrideTokens` validates.
		 */
		function tokensFor(palette) {
		  /** One role, both schemes. */
		  const both = (role) => ({ light: palette.light[role], dark: palette.dark[role] })
		  /** A role named differently per scheme — for the few tokens that flip polarity. */
		  const across = (lightRole, darkRole) => ({
		    light: palette.light[lightRole],
		    dark: palette.dark[darkRole],
		  })
		  /** The same value in both schemes: type, not colour. */
		  const fixed = (value) => ({ light: value, dark: value })

		  return {
		    /* ── stock: the page, and every surface raised off it ─────────────────────────
		       A CARD IS PAPER, NOT A FRAME. Surfaces are the next shade of the same stock
		       rather than a new colour, so `layer-1` (the first raised surface) is still the
		       page's own paper and the nesting deepens through paper-2 and paper-3. */
		    '--dsw-alias-bg-base': both('paper'),
		    '--dsw-alias-bg-layer-1': both('paper'),
		    '--dsw-alias-bg-layer-2': both('paper-2'),
		    '--dsw-alias-bg-layer-3': both('paper-3'),
		    '--dsw-alias-bg-overlay': both('paper-2'),
		    '--dsw-alias-bg-module-platform': both('paper-2'),
		    '--dsw-alias-bg-multi-select': both('paper-3'),
		    '--dsw-alias-bg-skeleton': both('paper-3'),
		    '--dsw-specific-sidebar-fill': both('paper-2'),
		    '--dsw-specific-menu': both('paper-3'),
		    '--dsw-specific-selector': both('paper-3'),
		    '--dsw-specific-tip': both('paper-3'),
		    '--dsw-specific-login-input': both('paper'),
		    '--dsw-specific-input-major': both('paper'),

		    /* ── ink, in three weights ─────────────────────────────────────────────────────
		       The third weight was unusable when this layer was written: `ink-3` measured 4.28:1
		       on paper-2 and 3.87:1 on paper-3, under the 4.5:1 floor, on exactly the raised
		       surfaces where the product paints captions and metadata — while the vault theme's
		       own comment claimed it had been darkened to clear that floor on paper-3. The
		       measurement contradicted the comment, so secondary and tertiary were set in the
		       same ink and the reason was written down rather than quietly worked around.

		       The palette has since been fixed at the source (light `ink-3` #756d59 → #665e4c,
		       measured 4.84:1 on paper-3 and 5.36:1 on paper-2), so the third weight is used for
		       what it is for and the hierarchy is three steps again. `Tools/test-mimir-skin.mjs`
		       measures all three on all three stocks, which is what would have caught the
		       original fault had it existed then. */
		    '--dsw-alias-label-primary': both('ink'),
		    '--dsw-alias-label-secondary': both('ink-2'),
		    '--dsw-alias-label-tertiary': both('ink-3'),
		    '--dsw-alias-label-caption': both('ink-3'),
		    '--dsw-alias-label-dimmed': both('line'),
		    '--dsw-alias-label-primary-inverted': both('paper'),
		    '--dsw-alias-label-primary-foreground': both('paper'),

		    /* ── the two weights of a separator ────────────────────────────────────────────
		       RULE vs LINE. `rule` is a hairline for separation; `line` is the one weight that
		       means "this is a surface". Everything else separates with space. */
		    '--dsw-alias-border-l1': both('rule-soft'),
		    '--dsw-alias-border-l2': both('rule'),
		    '--dsw-alias-border-l2-darkmode-thin': both('rule-soft'),
		    '--dsw-alias-border-l3': both('line'),
		    '--dsw-alias-border-l4': both('line'),

		    /* ── the accent, and the two voices ────────────────────────────────────────────
		       Sage is the accent (the mark, the teacher); cyan is the vault's furniture —
		       links and status — which is why the link is cyan and the brand is sage. */
		    '--dsw-alias-brand-primary': both('mark'),
		    '--dsw-alias-brand-text': both('paper'),
		    '--dsw-alias-link': both('cyan'),
		    '--dsw-specific-bubble': both('peach-soft'),
		    '--dsw-specific-bubble-highlight': both('mark-soft'),

		    /* ── interaction ─────────────────────────────────────────────────────────────── */
		    '--dsw-alias-interactive-bg-hover': both('paper-3'),
		    '--dsw-alias-interactive-bg-hover-solid': both('paper-3'),
		    '--dsw-alias-interactive-bg-hover-accent': both('mark-soft'),
		    '--dsw-alias-interactive-bg-active': both('mark-soft'),
		    '--dsw-alias-button-primary-fill': both('mark'),
		    '--dsw-alias-button-primary-hover': both('ink'),
		    '--dsw-alias-button-primary-dimmed': both('mark-soft'),
		    '--dsw-alias-button-elevated-fill': both('paper'),
		    '--dsw-alias-button-floating-fill': both('paper-2'),
		    '--dsw-alias-button-floating-hover': both('paper-3'),
		    '--dsw-alias-button-contrast-fill': both('paper-3'),
		    '--dsw-alias-button-ghost-active-fill': both('mark-soft'),
		    '--dsw-alias-button-ghost-active-border': both('mark'),
		    '--dsw-alias-button-ghost-active-hover': both('paper-3'),

		    /* ── code, quotations and the rest of the page furniture ─────────────────────── */
		    '--dsw-alias-markdown-code-block': both('paper-2'),
		    '--dsw-alias-markdown-code-block-banner': both('paper-3'),
		    '--dsw-alias-markdown-code-segment-selected': both('paper'),
		    '--dsw-alias-markdown-code-segment-unselected': both('paper-2'),
		    '--dsw-alias-markdown-inline-code': both('paper-2'),
		    '--dsw-alias-markdown-citation': both('paper-2'),
		    '--dsw-alias-markdown-tag': both('mark-soft'),
		    '--dsw-alias-markdown-placeholder': both('paper-2'),

		    /* ── scrollbars: hairlines, not slabs ────────────────────────────────────────── */
		    '--dsw-alias-scrollbar-bg-l1': both('rule'),
		    '--dsw-alias-scrollbar-bg-l2': both('rule'),
		    '--dsw-alias-scrollbar-hover-l1': both('line'),
		    '--dsw-alias-scrollbar-hover-l2': both('line'),

		    /* ── state ──────────────────────────────────────────────────────────────────────
		       Success and warning are Mimir's mint and peach. **Error is not overridden**: the
		       palette holds no red, and a colour invented here would be a second source for a
		       signal that must stay unmistakable. The product's own red is legible on both
		       grounds, so it stays. */
		    '--dsw-alias-state-success-primary': both('mint'),
		    '--dsw-alias-state-success-secondary': both('mint'),
		    '--dsw-alias-state-success-tertiary': both('mark-soft'),
		    /* A WARNING IS INK; ITS MARK IS PEACH. The palette's peach measures 4.02:1 as text on
		       paper — a mark's ratio, not a sentence's. So the label takes an ink that reads and
		       the accent that carries the meaning is the indicator beside it, which is the one
		       place `warn-primary`/`warn-secondary` are used. */
		    '--dsw-alias-state-warn-primary': both('peach'),
		    '--dsw-alias-state-warn-secondary': both('peach'),
		    '--dsw-alias-state-warn-label': both('ink'),
		    '--dsw-alias-state-warn-tertiary': both('peach-soft'),
		    '--dsw-alias-state-business-primary': both('cyan'),
		    '--dsw-alias-state-business-tertiary': both('paper-2'),

		    /* ── popovers, which must stay legible against the page ──────────────────────── */
		    '--dsw-alias-toast-bg': across('ink', 'paper-3'),
		    '--dsw-alias-tooltip-bg': across('ink', 'paper-3'),

		    /* ── the two faces ─────────────────────────────────────────────────────────────
		       SERIF WHERE IT IS READ, MONO WHERE IT IS FURNITURE.

		       `--dsw-font-family` is the single root of the product's type system: the markdown
		       base, every heading, the table and message text all resolve their family through
		       it, so pointing it at the serif turns the whole reading surface at once — and it
		       keeps the product's own content-font-size axis, which is written separately onto
		       `body` by the presenter.

		       That leaves the furniture to be named. The four steps of the small type scale
		       (`s`/`xs`/`xxs`/`xxxs`) are what labels, buttons, counts and metadata are set in,
		       so those four composites — and their strong variants — are restated here against
		       the mono. The sizes and leadings are the product's own, copied verbatim; only the
		       family changes. Code is set from `--ds-font-family-code`, a name of its own. */
		    '--dsw-font-family': fixed(SERIF),
		    '--dsw-font-mono': fixed(MONO),
		    '--ds-font-family-code': fixed(MONO),
		    '--dsw-font-s-14': fixed(`14px/22px ${MONO}`),
		    '--dsw-font-s-strong-14': fixed(`500 14px/22px ${MONO}`),
		    '--dsw-font-xs-13': fixed(`13px/20px ${MONO}`),
		    '--dsw-font-xs-strong-13': fixed(`500 13px/20px ${MONO}`),
		    '--dsw-font-xxs-12': fixed(`12px/18px ${MONO}`),
		    '--dsw-font-xxs-strong-12': fixed(`500 12px/18px ${MONO}`),
		    '--dsw-font-xxxs-11': fixed(`11px/14px ${MONO}`),
		    '--dsw-font-xxxs-strong-11': fixed(`500 11px/14px ${MONO}`),

		    /* ── the skin's own names, for the board's stylesheet ──────────────────────────
		       These are not product tokens and nothing in DSH reads them: they exist so the one
		       stylesheet this skin injects can paint in the vault's palette without a second copy
		       of it. The presenter writes them onto `<body>` exactly like the rest of the layer,
		       so they switch with the active colour scheme, and `Tools/test-mimir-skin.mjs`
		       exempts the `--mm-` prefix from the "does DSH know this name" check for that
		       reason — a name only we read is known by construction. */
		    '--mm-paper': both('paper'),
		    '--mm-paper-2': both('paper-2'),
		    '--mm-paper-3': both('paper-3'),
		    '--mm-ink': both('ink'),
		    '--mm-ink-2': both('ink-2'),
		    '--mm-rule': both('rule'),
		    '--mm-rule-soft': both('rule-soft'),
		    '--mm-line': both('line'),
		    '--mm-mark': both('mark'),
		    '--mm-mark-soft': both('mark-soft'),
		    '--mm-mint': both('mint'),
		    '--mm-peach': both('peach'),
		    '--mm-cyan': both('cyan'),
		    '--mm-serif': fixed(SERIF),
		    '--mm-mono': fixed(MONO),
		  }
		}

		/**
		 * The board's stylesheet, in the vault's own language.
		 *
		 * TWO RULES CARRY OVER FROM THE THEME, and they are the reason this does not look like a
		 * card grid. First, RULE vs LINE: `--mm-rule` is a hairline for separation and `--mm-line`
		 * is the one weight that means "this is a surface"; everything else separates with space or
		 * with a single coloured edge on the left. Second, A CARD IS PAPER, NOT A FRAME: the
		 * question is the next shade of the same stock with a 3px accent edge along the top and an
		 * offset shadow in the corner — no outlines, no rounding.
		 *
		 * The two faces do the rest of the work. Anything that is READ — the question, an option,
		 * a spine node — is the serif; anything that is furniture — the label, the count, the
		 * hint, a missing drawing's note — is the blocky monospace, letterspaced.
		 */
		const BOARD_CSS = `
		.mm-board { margin: 6px 0 10px; max-width: 100%; }
		.mm-board__label { font: 11px/14px var(--mm-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--mm-ink-2); display: flex; align-items: baseline; gap: 10px; }
		.mm-board__count { letter-spacing: .06em; color: var(--mm-ink-2); }
		.mm-question { background: var(--mm-paper); border-top: 3px solid var(--mm-mark); box-shadow: 4px 4px 0 var(--mm-rule); padding: 14px 16px 12px; margin: 10px 0 0; }
		.mm-question__text { font-family: var(--mm-serif); font-size: 17px; line-height: 26px; color: var(--mm-ink); margin: 0; }
		.mm-options { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
		.mm-option { font-family: var(--mm-serif); font-size: 15px; line-height: 23px; color: var(--mm-ink); border-left: 3px solid var(--mm-rule); padding: 3px 0 3px 11px; }
		.mm-hint { font: 12px/18px var(--mm-mono); color: var(--mm-ink-2); margin: 12px 0 0; }
		.mm-spine { margin: 14px 0 0; padding: 10px 0 0; border-top: 1px solid var(--mm-rule); display: flex; flex-direction: column; gap: 3px; }
		.mm-node { display: grid; grid-template-columns: 3px 1fr; gap: 11px; align-items: baseline; }
		.mm-node__mark { width: 3px; height: 15px; background: var(--mm-line); }
		.mm-node__label { font-family: var(--mm-serif); font-size: 14px; line-height: 21px; color: var(--mm-ink); }
		.mm-node[data-state="held"] .mm-node__mark { background: var(--mm-mint); }
		.mm-node[data-state="learning"] .mm-node__mark { background: var(--mm-peach); }
		.mm-node[data-state="fragile"] .mm-node__mark { background: var(--mm-peach); }
		.mm-node[data-state="planned"] .mm-node__label { color: var(--mm-ink-2); }
		.mm-drawings { margin: 14px 0 0; display: flex; flex-direction: column; gap: 12px; }
		.mm-drawing { background: var(--mm-paper); border-left: 3px solid var(--mm-rule); padding: 8px; }
		.mm-drawing img { display: block; width: 100%; height: auto; }
		.mm-drawing__name { font: 11px/14px var(--mm-mono); letter-spacing: .1em; color: var(--mm-ink-2); margin: 0 0 6px; }
		.mm-drawing__note { font: 12px/18px var(--mm-mono); color: var(--mm-ink-2); margin: 0; }

		/* THE ASK ROW IS A RECORD, NOT A SECOND QUESTION.
		   The answer controls are a composer card owned by the product (dsh-client-ui-user-questions
		   takes the composer seat and resolves the call through pending.answer), so this row is
		   display-only. That is exactly why it must stay QUIET: the board above it is where the
		   question is read, the composer card is where it is answered, and a third loud rendering
		   in between would be noise. What a transcript row owes the reader is the record — what was
		   asked, and what he said. So it is mono furniture with one line of serif, and once it is
		   settled it shows the answer rather than the options. */
		.mm-ask { margin: 6px 0 10px; padding-left: 3px; border-left: 3px solid var(--mm-rule); }
		.mm-ask[data-waiting="true"] { border-left-color: var(--mm-peach); }
		.mm-ask[data-waiting="false"] { border-left-color: var(--mm-mark); }
		.mm-ask__eyebrow { font: 11px/14px var(--mm-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--mm-ink-2); display: flex; align-items: baseline; gap: 8px; }
		.mm-ask__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mm-peach); display: inline-block; }
		.mm-ask__text { font-family: var(--mm-serif); font-size: 15px; line-height: 23px; color: var(--mm-ink); margin: 4px 0 0; padding-left: 11px; }
		.mm-ask__answer { font: 12px/18px var(--mm-mono); color: var(--mm-ink); margin: 3px 0 0; padding-left: 11px; }
		.mm-ask__answer::before { content: "\\2192\\00a0"; color: var(--mm-mark); }

		/* THE HEADER CONTROL. Furniture, so it is mono and letterspaced like everything else that
		   is not read; hairline hover rather than a filled button, because the header already has
		   enough surfaces in it. The two A's are the size mark — the same letter at two sizes says
		   what the button does without a word. */
		.mm-controls { display: flex; align-items: center; gap: 1px; }
		.mm-icon { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 7px; color: var(--mm-ink-2); cursor: pointer; background: none; border: 0; font: 11px/14px var(--mm-mono); letter-spacing: .08em; }
		.mm-icon:hover { color: var(--mm-ink); background: var(--mm-paper-3); }
		.mm-icon:focus-visible { outline: 1px solid var(--mm-mark); outline-offset: -1px; }
		.mm-icon svg { display: block; width: 15px; height: 15px; }
		.mm-icon__a { font-family: var(--mm-mono); line-height: 1; }
		.mm-icon__a--small { font-size: 9px; align-self: flex-end; padding-bottom: 2px; }
		.mm-icon__dots { display: inline-flex; align-items: center; gap: 3px; margin-left: 2px; }
		.mm-icon__dot { display: block; width: 4px; height: 4px; border-radius: 50%; background: var(--mm-ink-3); }
		.mm-icon__dot[data-on="true"] { background: var(--mm-mark); }

		/* THE CURTAIN. Above everything, deaf to the pointer, and painted the ground the piece was
		   rendered on before its first frame arrives — the two builds miss their own grounds by
		   different amounts, and a window coloured from the pane's palette instead left the artwork
		   sitting on it as a slightly wrong rectangle. */
		.mm-splash { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; pointer-events: none; }
		.mm-splash__still, .mm-splash__clip { grid-area: 1 / 1; display: block; width: 100%; height: 100%; object-fit: contain; }
		.mm-splash__still[data-playing="true"] { opacity: 0; }

		/* ── THE SECOND COLUMN ────────────────────────────────────────────────────────
		   WHAT THE PRODUCT DOES BY DEFAULT, and the whole of the friction: with a composer
		   overlay present it makes the seat position:absolute, bottom:0, left:0, right from
		   the scrollbar width, inside the scrolling body. So the chat box and the question card
		   do not sit BESIDE the lesson — they sit ON it, floating over the bottom of the text,
		   which is why reading back while a question waits means losing a screenful.

		   Both regions are plain children of one container (the transcript wrapper
		   data-slot="conversation.session" and the seat element carrying data-composer-seat,
		   inside the element carrying data-conversation-scroll), so the fix is a row: the
		   transcript takes the flexible side and the composer takes a column beside it. Nothing
		   moves in the DOM, so nothing in the product loses its node — and the two places the
		   product measures this seat both degrade instead of breaking. The paging-anchor read
		   takes its top as "the bottom of the visible transcript" and falls back to its row-walk
		   when that is not below the viewport top; the ResizeObserver watching the seat only
		   re-runs the follow-to-bottom.

		   WHY THE IMPORTANTS ARE HONEST HERE. The rule being overridden is both more specific and
		   later in the sheet, and reaching past it with selector gymnastics would hide what is
		   actually happening. This is a deliberate override of a product layout, and it says so.
		   The composer-height variable goes to zero for the same reason: the product uses it to
		   reserve room under the transcript for a composer that no longer overhangs it.

		   ACTIVE PHASE ONLY, AND THAT SCOPE IS THE WHOLE OF A BUG. On a blank session the product
		   is not laying out a conversation at all: it shows the hero and centres the composer in
		   the middle of an empty screen, deliberately. Two columns there dropped that composer into
		   a narrow strip at the bottom right with the hero's margins gone — which is exactly what
		   it looked like: a box shoved into a corner. The hero is the product's design to keep; the
		   column is for a conversation that exists. The phase attribute sits on an ancestor the
		   product already sets it on, so this needs no new hook. */
		[data-phase="active"] [data-conversation-scroll]:has(> [data-composer-seat]) {
		  --dsh-composer-height: 0px !important;
		  flex-direction: row;
		  align-items: flex-start;
		  /* AND IT IS THE POSITIONING CONTEXT FOR THE SEAM. The grip that drags the two columns
		     apart is a child of this row — not of the column, where the column's own scroll would
		     carry it away and its own clip would cut it — so the row has to be what the seam's left offset
		     resolves against. Nothing in here depended on a containing block further up: the
		     composer's own menus already anchor to a relative wrapper inside their card, and the
		     product sets exactly this declaration on the row itself in the overlay case. */
		  position: relative;
		}
		/* THE LEFT COLUMN GETS A HEIGHT, AND IT IS THE WHOLE OF WHETHER THE COLUMN BESIDE IT
		   STAYS ON SCREEN. Sizing the transcript to its content is what the product does inside a
		   scroll container — it collapses the chat's own scroller ([data-conversation-scroll]
		   leaving its root flex:none and height:auto, its inner scroll overflow:visible) so the
		   WRAPPER at [data-conversation-scroll] is the single scroller and the product's
		   follow-the-bottom and paging-anchor code, which resolves that wrapper by name, keeps
		   working. Left like that under this row, though, the wrapper's content box becomes as
		   tall as the conversation.

		   AND STICKY RESOLVES AGAINST THE CONTENT BOX, NOT THE VIEWPORT. A column pinned to the
		   bottom of a content box 4000px tall is only at the foot of the SCREEN while the scroller
		   is at the very top; measured in Chrome at 1400x900, scrolled to the middle it sits at
		   −1096px and at the foot of the conversation at −2862px — the chat box and the question
		   card simply gone. align-self: flex-end had bought nothing: the static position that
		   bottom: 0 needs never was the bottom of the row.

		   So the transcript is given the height of the space it is drawn in — height: 100%
		   resolves against the scrollport, which is definite here — and scrolls inside itself.
		   That is the fix the wrapper's own naming never needed: the wrapper stays the element the
		   product's scroll code resolves, and it now has nothing to scroll (its scrollHeight is
		   its clientHeight), so the reader's scroll lands on the transcript. Measured the same
		   way, the composer column holds 671..757 at every offset, with a 10-turn transcript, a
		   long question card, and the transcript scrolled to its foot — a measurement that no
		   longer reproduces, and the reason is the paragraph below.

		   AND THE WRAPPER HAS NO BOX TO BE GIVEN A HEIGHT. Measured in the running app on
		   2026-09-19: every slot outlet is drawn with style="display: contents", the renderer's
		   ANCHOR_STYLE — "the anchor is purely addressable surface", so that flex and grid parents
		   see the slot's own children. An element with display: contents has no principal box, so
		   height, flex and overflow on it do nothing at all, and this rule was inert: the row was
		   as tall as the slot's CHILD (6961px at 1400x900) and the composer column sat at the foot
		   of that, at −5364px with the transcript scrolled to its end — on screen only while the
		   scroller was at the very top. So the rule that carries the height is repeated on the
		   child, below, and this one stays as what it is: the statement of intent, true again the
		   day the anchor becomes a box.

		   overscroll-behavior is not decoration: without it a wheel at the transcript's end
		   would chain to the wrapper and — because the wrapper's own content is now exactly the
		   viewport — move the composer column off the screen it was just pinned to. */
		[data-phase="active"] [data-conversation-scroll] > [data-slot="conversation.session"] {
		  flex: 1 1 auto;
		  min-width: 0;
		  min-height: 0;
		  height: 100%;
		  overflow-y: auto;
		  overscroll-behavior: contain;
		}

		/* THE SAME SIZING, ON THE BOX THAT EXISTS. The slot's own child is the element the product
		   draws the transcript in, and under a display: contents anchor it is the flex item of the
		   row — which is why the wrapper above can say all of this and move nothing.

		   THREE DECLARATIONS CARRY !important, AND ONLY WHERE THEY ANSWER SOMETHING. In the
		   composer-overlay case the product sizes this same child from a more specific rule of its
		   own (.wSkVaW_scrollBody:has([data-conversation-composer-overlay]) > [data-slot=
		   "conversation.session"] > .wSkVaW_viewArea sets flex: 1 1 0, min-height: 0 and
		   overflow: hidden), and a bare overflow: hidden would strand the transcript — the one
		   case where it matters is a question waiting, which is the case this whole block exists
		   for. The other three declarations answer nothing and take no weight. */
		[data-phase="active"] [data-conversation-scroll] > [data-slot="conversation.session"] > * {
		  flex: 1 1 auto !important;
		  min-width: 0;
		  min-height: 0 !important;
		  height: 100%;
		  overflow-y: auto !important;
		  overscroll-behavior: contain;
		}

		/* THE COMPOSER COLUMN IS HELD AT THE FOOT OF THE SCREEN. Left stretched, the seat takes the
		   row's whole height and its content — which is flex:none — sits at the top of that tall
		   column, which reads as the chat box having floated up to the start of the conversation,
		   so it is sized to its content and aligned to the foot of the row.

		   THAT ONLY HOLDS BECAUSE THE TRANSCRIPT BESIDE IT IS NO LONGER CONTENT-TALL. Sticky keeps
		   an element within its scrollport but cannot invent a scrollport shorter than the content
		   box it is measured against, and the row's height is the taller of its two columns. With
		   the transcript capped at the scrollport (the rule above), the row is one viewport tall,
		   the seat's static position IS the foot of the row, and bottom: 0 has an edge to hold.
		   The two rules are one mechanism; neither works alone.

		   THE COLUMNS DO SCROLL INDEPENDENTLY, AND THE PRODUCT'S NAMING IS UNTOUCHED BY IT. The
		   chat's own scroll code resolves its container by taking the nearest ancestor carrying
		   data-conversation-scroll — it names that element rather than hunting for whatever
		   overflows — and that element still exists here and is still what the lookup returns. It
		   simply has nothing left to scroll: its content is exactly its own height, so the reader's
		   scroll happens in the transcript and the column stays where he can reach it. */
		[data-phase="active"] [data-conversation-scroll] > [data-composer-seat] {
		  position: sticky !important;
		  /* EVERY EDGE NAMED APART, AND EACH ONE IMPORTANT. Writing this as a shorthand and then a
		     bare bottom is what put the box miles down a long conversation: the inset shorthand
		     resets all four edges WITH importance, so the later bottom lost to it, the sticky
		     element had no edge to hold, and it stayed at its static position — the foot of a
		     column as tall as the transcript. The product's rule sets left and right as well, and
		     it is more specific, so each edge has to be answered on its own terms. */
		  top: auto !important;
		  right: auto !important;
		  left: auto !important;
		  bottom: 0 !important;
		  /* Its static position must be the FOOT of the column, which under the rule above is the
		     foot of the scrollport: pinned to the start it would sit at the top exactly as before. */
		  align-self: flex-end;
		  /* THE WIDTH IS THE BROWSER'S TO REMEMBER, AND THE DRAG'S TO SET. The --mm-column property is written
		     on the ROW by the seam's drag and inherited down to here, so there is one copy of the
		     number, and the seam's own left offset is computed from the same one; the clamp is what a page
		     with nothing stored falls back to, so the first paint of a fresh browser is the width
		     this skin chose rather than nothing. */
		  flex: 0 0 var(--mm-column, clamp(300px, 32%, 460px));
		  min-width: 0;
		  /* THE DRAG'S ARITHMETIC NEEDS THE NUMBER IT WRITES TO BE THE NUMBER IT READS. The
		     product's own elements are content-box, and this one carries a border and a gutter, so a
		     basis of 402px would measure as 413px — and a second drag from that measurement would
		     walk the column outwards by eleven pixels every time the seam was moved. Border-box makes
		     the basis, the measured width and the seam's own left offset the same number. */
		  box-sizing: border-box;
		  /* THE BOX SPANS THE COLUMN, AND THAT IS WHAT KEEPS A POPUP WHOLE. The composer's own
		     menus — the permission chip's list is the one that showed it — open UPWARD from a box
		     docked at the foot of the screen, so they leave the composer's own rectangle; and a
		     scroll container clips everything outside its box, in every direction, so the menu was
		     cut at exactly the column's top edge. Measured 2026-09-19: the seat's box was as tall
		     as its content (154px against a 824px column), the menu drew three rows and exactly one
		     of them was visible. Giving the box the column's own height puts that menu back inside
		     the thing that clips it, and the content is anchored to the FOOT of that taller box so
		     the composer still sits at the foot of the screen. */
		  min-height: 100%;
		  /* AS TALL AS THE CONVERSATION, NOT AS TALL AS THE WINDOW. The product measures the
		     scroller and publishes its height as this variable, so the column is capped at the
		     space it is drawn in and scrolls inside itself — a question card longer than the screen
		     stays reachable inside the column instead of running off the bottom of it. The viewport
		     fallback is for the first frame, before that measurement is published; a viewport unit
		     was the wrong ceiling by the height of everything above the conversation, which is why
		     it is only ever the fallback. And 100% is the same ceiling reached through the box
		     itself, which is the row: with min-height above, the box is exactly the row in both
		     directions, so content can escape neither end of it. */
		  max-height: min(100%, var(--dsh-conversation-viewport-height, 100dvh));
		  /* Anchored to the foot, and the safe keyword is not decoration: a question card taller than the box
		     would otherwise overflow ABOVE the box's top — the one direction a reader cannot scroll
		     to, because the box has no scroll above its own start — and with it the alignment falls
		     back to the start, so the overflow is downward, where the column's own scrollbar reaches
		     it. Measured the same day with a card forced to 1400px against an 824px column: the top
		     of the card sat at the top of the box at scroll 0, and the whole of the composer was
		     reachable at the end of it. */
		  justify-content: safe flex-end;
		  overflow-y: auto;
		  /* The same bargain the transcript makes at its own end: a wheel that has run out of column
		     must not be handed to the scroller behind it, or the column walks off the screen it was
		     just pinned to. */
		  overscroll-behavior: contain;
		  border-left: 1px solid var(--mm-rule);
		  /* Room to breathe beside the hairline. The composer brings its own inner padding, but
		     against a rule it reads as pinned to the edge without this. */
		  padding-left: 10px;
		}

		/* THE PRODUCT'S OWN WIDTH HANDLES ARE OFF. It draws a pair of drag strips at the edges of the
		   conversation that change the chat's CONTENT width — dsh.conversation.contentWidth, floor 640 — and once a seam moves the boundary between the two columns, those are a second width
		   control that disagrees with the first: the right-hand strip sits where the seam is, so the
		   grab he means lands on the handle he does not, and neither control can be trusted to be the
		   one that moved. The product hides exactly these strips itself whenever a composer overlay is
		   present, so this is that same move made permanent. The hook is the element's own stable
		   attribute rather than the hashed class beside it, and no other package in the app reads it:
		   the sidebar's resizer is a different component with its own hook. */
		[data-phase="active"] [data-width-handle] { display: none !important; }

		/* THE SEAM BETWEEN THE COLUMNS, AND IT MOVES. The composer column's width is not a fact about
		   the design: the lesson is prose and the box that answers it is a box, and which of the two
		   wants more room changes with the question and with the window. So the hairline between them
		   is a separator — draggable, arrow-keyed, remembered per browser — and this is the strip that
		   does it. It is a child of the ROW rather than of the column, because the column scrolls its
		   own content (which would carry the strip away) and clips it (which would cut it), and it is
		   centred on the seam by the same expression the column's own basis uses, so the two cannot
		   disagree about where the boundary is.

		   AT REST IT DRAWS NOTHING. The column already draws that hairline with its own border-left,
		   so a second line would make the seam read as two surfaces; the accent appears at 3px only
		   while the pointer is on it, the keyboard is on it, or a drag is in progress — which is the
		   only moment the seam needs to be findable at all. */
		/* IT MUST OUT-PAINT THE COLUMN, AND THE COLUMN IS NOT A PLAIN BOX. The product gives the
		   composer seat z-index 7 — 9 while one of its menus is open — and a seam painted under it is
		   a seam the pointer never reaches: the seat answers, the drag never starts, and it reads as a
		   strip that does nothing. Measured 2026-09-19: elementFromPoint at the seam returned the seat.
		   10 is above the composer and still far below the app's own overlays. */
		.mm-grip{position:absolute;top:0;bottom:0;left:calc(100% - var(--mm-column, clamp(300px, 32%, 460px)));width:9px;margin-left:-4px;background:none;border:0;padding:0;cursor:col-resize;touch-action:none;z-index:10}
		.mm-grip:after{content:"";position:absolute;top:0;bottom:0;left:4px;width:1px;background:var(--mm-mark);opacity:0;transition:opacity 120ms linear}
		.mm-grip:hover:after,.mm-grip:focus-visible:after,.mm-grip[data-dragging=true]:after{left:3px;width:3px;opacity:1}
		.mm-grip:focus-visible{outline:1px solid var(--mm-mark);outline-offset:-1px}
		`

		/** The one style tag this skin owns, so re-applying replaces rather than piles up. */
		const STYLE_ID = 'dsh-mimir-skin/board'

		/** Inject the board's stylesheet once; a documentless run simply skips it. */
		function installStyles() {
		  if (typeof document === 'undefined') return () => {}
		  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
		  if (existing !== null) return () => existing.remove()
		  const tag = document.createElement('style')
		  tag.dataset.pluginCss = STYLE_ID
		  tag.textContent = BOARD_CSS
		  document.head.appendChild(tag)
		  return () => tag.remove()
		}

		/** Whether a value is a plain object; every field here arrives unvalidated on replay. */
		function isRecord(value) {
		  return typeof value === 'object' && value !== null && !Array.isArray(value)
		}

		/**
		 * Read the board out of a tool call, preferring the settled presentation meta.
		 *
		 * THE FALLBACK IS NOT DECORATION. While the call is still running there is no `meta` yet,
		 * so the row reads the committed arguments instead — which is the same thing the teacher
		 * wrote and is already durable. A board that appears the moment the tool is called, and
		 * gains its drawings when it settles, is a board that never shows an empty frame.
		 *
		 * @param block - the frozen running call or settled node handed to the row.
		 * @returns `{ nodes, hint, question, options, drawings }`, or null when this is not a board.
		 */
		function boardOf(block) {
		  if (!isRecord(block)) return null

		  const meta = block.meta
		  if (isRecord(meta) && Array.isArray(meta.nodes)) {
		    return {
		      nodes: meta.nodes,
		      hint: typeof meta.hint === 'string' ? meta.hint : '',
		      question: typeof meta.question === 'string' ? meta.question : '',
		      options: Array.isArray(meta.options) ? meta.options : [],
		      drawings: Array.isArray(meta.drawings) ? meta.drawings : [],
		    }
		  }

		  const call = isRecord(block.call) ? block.call : block
		  let args = null
		  try {
		    args = JSON.parse(call.argsRaw)
		  } catch {
		    return null
		  }
		  if (!isRecord(args) || !Array.isArray(args.spine)) return null
		  return {
		    nodes: args.spine,
		    hint: typeof args.hint === 'string' ? args.hint : '',
		    question: typeof args.question === 'string' ? args.question : '',
		    options: Array.isArray(args.options) ? args.options : [],
		    drawings: [],
		  }
		}

		/**
		 * The board, drawn inline in the conversation.
		 *
		 * A pure function of the call: it holds no state, fetches nothing, and cannot fail in a way
		 * that loses anything. That is the whole difference between this and the window it
		 * replaces — a row that renders wrongly shows a wrong picture, and the lesson underneath
		 * is untouched.
		 *
		 * @param props - the tool view's owner props, of which only `block` is used.
		 * @returns the board, or nothing when the call is not a board.
		 */
		function BoardRow(props) {
		  const board = boardOf(props?.block)
		  if (board === null) return null

		  const children = []

		  const count = `${board.nodes.length} node${board.nodes.length === 1 ? '' : 's'}`
		  children.push(
		    React.createElement(
		      'div',
		      { className: 'mm-board__label', key: 'label' },
		      React.createElement('span', null, 'the lesson'),
		      React.createElement('span', { className: 'mm-board__count' }, count),
		    ),
		  )

		  if (board.question.length > 0) {
		    const card = [
		      React.createElement('p', { className: 'mm-question__text', key: 'q' }, board.question),
		    ]
		    if (board.options.length > 0) {
		      card.push(
		        React.createElement(
		          'ul',
		          { className: 'mm-options', key: 'options' },
		          board.options.map((option, index) =>
		            React.createElement('li', { className: 'mm-option', key: String(index) }, String(option)),
		          ),
		        ),
		      )
		    }
		    if (board.hint.length > 0) {
		      card.push(React.createElement('p', { className: 'mm-hint', key: 'hint' }, board.hint))
		    }
		    children.push(React.createElement('div', { className: 'mm-question', key: 'question' }, card))
		  } else if (board.hint.length > 0) {
		    children.push(React.createElement('p', { className: 'mm-hint', key: 'hint' }, board.hint))
		  }

		  if (board.nodes.length > 0) {
		    children.push(
		      React.createElement(
		        'div',
		        { className: 'mm-spine', key: 'spine' },
		        board.nodes.map((entry, index) => {
		          const node = isRecord(entry) ? entry : {}
		          return React.createElement(
		            'div',
		            { className: 'mm-node', 'data-state': String(node.state ?? 'planned'), key: String(index) },
		            React.createElement('span', { className: 'mm-node__mark' }),
		            React.createElement('span', { className: 'mm-node__label' }, String(node.node ?? '')),
		          )
		        }),
		      ),
		    )
		  }

		  if (board.drawings.length > 0) {
		    children.push(
		      React.createElement(
		        'div',
		        { className: 'mm-drawings', key: 'drawings' },
		        board.drawings.map((drawing, index) => {
		          const one = isRecord(drawing) ? drawing : {}
		          const body =
		            one.missing === true || typeof one.svg !== 'string' || one.svg.length === 0
		              ? React.createElement(
		                  'p',
		                  { className: 'mm-drawing__note' },
		                  `not shown — ${String(one.note ?? 'unavailable')}`,
		                )
		              : /* A data URI, not innerHTML: an image cannot run a script, so a drawing
		                   from the vault is rendered without handing it the page. */
		                React.createElement('img', {
		                  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(one.svg)}`,
		                  alt: `Drawing: ${String(one.name ?? '')}`,
		                })
		          return React.createElement(
		            'figure',
		            { className: 'mm-drawing', key: String(index), style: { margin: 0 } },
		            React.createElement('figcaption', { className: 'mm-drawing__name' }, String(one.name ?? '')),
		            body,
		          )
		        }),
		      ),
		    )
		  }

		  return React.createElement('div', { className: 'mm-board' }, children)
		}

		/** The text of a settled call's result, joined; empty while it is still running. */
		function resultText(block) {
		  if (!Array.isArray(block?.content)) return ''
		  return block.content
		    .filter((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
		    .map((part) => part.text)
		    .join('\n')
		}

		/**
		 * The answers a settled ask carries, keyed by question id.
		 *
		 * Read from the result JSON rather than from any state of ours, because there is none:
		 * the row is a pure function of the call the session already holds.
		 *
		 * @param block - the settled tool block.
		 * @returns a map of question id → what he said, or null when the result is not readable.
		 */
		function answersOf(block) {
		  let parsed = null
		  try {
		    parsed = JSON.parse(resultText(block))
		  } catch {
		    return null
		  }
		  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return null
		  const byId = new Map()
		  for (const answer of parsed.answers) {
		    if (!isRecord(answer) || typeof answer.id !== 'string') continue
		    const selected = Array.isArray(answer.selected) ? answer.selected.filter((one) => typeof one === 'string') : []
		    const custom = typeof answer.custom === 'string' ? answer.custom : ''
		    byId.set(answer.id, { selected, custom, skipped: answer.skipped === true })
		  }
		  return byId
		}

		/**
		 * Read an `ask_user_question` call into the record this row draws.
		 *
		 * @param block - the frozen running call or settled node.
		 * @returns `{ questions, settled, answers }`, or null when this is not an ask.
		 */
		function askedOf(block) {
		  if (!isRecord(block)) return null
		  const call = isRecord(block.call) ? block.call : block
		  let args = null
		  try {
		    args = JSON.parse(call.argsRaw)
		  } catch {
		    return null
		  }
		  if (!isRecord(args) || !Array.isArray(args.questions) || args.questions.length === 0) return null

		  const questions = []
		  for (const raw of args.questions) {
		    if (!isRecord(raw) || typeof raw.question !== 'string') continue
		    const options = []
		    if (Array.isArray(raw.options)) {
		      for (const option of raw.options) {
		        if (typeof option === 'string') options.push(option)
		        else if (isRecord(option) && typeof option.label === 'string') options.push(option.label)
		      }
		    }
		    questions.push({ id: typeof raw.id === 'string' ? raw.id : '', question: raw.question, options })
		  }
		  if (questions.length === 0) return null

		  const settled = Array.isArray(block.content) || block.isError === true
		  return { questions, settled, answers: settled ? answersOf(block) : null }
		}

		/**
		 * The record of a question, drawn quietly in the conversation.
		 *
		 * @param props - the tool view's owner props, of which only `block` is used.
		 * @returns the record, or nothing when the call is not an ask.
		 */
		function AskedRow(props) {
		  const asked = askedOf(props?.block)
		  if (asked === null) return null

		  const children = [
		    React.createElement(
		      'div',
		      { className: 'mm-ask__eyebrow', key: 'eyebrow' },
		      asked.settled ? null : React.createElement('span', { className: 'mm-ask__dot' }),
		      React.createElement('span', null, asked.settled ? 'answered' : 'waiting for your answer'),
		    ),
		  ]

		  for (const [index, question] of asked.questions.entries()) {
		    children.push(
		      React.createElement('p', { className: 'mm-ask__text', key: `q${index}` }, question.question),
		    )
		    if (!asked.settled) continue
		    const answer = asked.answers?.get(question.id)
		    const said = answer === undefined ? '' : [answer.selected.join(', '), answer.custom].filter((part) => part.length > 0).join(' — ')
		    children.push(
		      React.createElement(
		        'p',
		        { className: 'mm-ask__answer', key: `a${index}` },
		        said.length > 0 ? said : 'no answer recorded',
		      ),
		    )
		  }

		  return React.createElement('div', { className: 'mm-ask', 'data-waiting': asked.settled ? 'false' : 'true' }, children)
		}

		/* ── the seam between the two columns ─────────────────────────────────────────── */

		/**
		 * The width of the composer column, and the rule a drag obeys.
		 *
		 * THE NUMBERS ARE A CLAIM ABOUT TWO COLUMNS, NOT ONE. The column may not go below COLUMN_MIN —
		 * under that the composer's own row of controls wraps and the box stops reading as a box — and
		 * it may not take the room the transcript is for, so the ceiling is the smaller of COLUMN_MAX
		 * and "the row, less TRANSCRIPT_MIN". A drag that asks for more stops at that edge rather than
		 * being refused, because a seam that stops following the pointer has stopped being a seam.
		 */
		const COLUMN_MIN = 280
		const COLUMN_MAX = 760
		const TRANSCRIPT_MIN = 360

		/** Where the chosen width is kept: per browser, as the product keeps its own content width. */
		const COLUMN_KEY = 'dsh-mimir-skin/column'

		/**
		 * The width a seam drag may actually produce.
		 *
		 * Pure, and exported, because this is the whole of what a drag decides: the pointer's pixels
		 * become a number here and nowhere else, so the rule can be checked without a browser.
		 *
		 * @param wanted - the width the pointer asked for, in pixels.
		 * @param row - the width the two columns share, in pixels.
		 * @returns the width to apply — never below the floor, never wider than the row allows.
		 */
		function clampColumn(wanted, row) {
		  const room = Number.isFinite(row) && row > 0 ? row - TRANSCRIPT_MIN : COLUMN_MAX
		  const ceiling = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, room))
		  const asked = Number.isFinite(wanted) ? wanted : COLUMN_MIN
		  return Math.round(Math.min(Math.max(asked, COLUMN_MIN), ceiling))
		}

		/** The width this browser last chose, or null when it has chosen none or cannot say. */
		function readColumnWidth() {
		  if (typeof window === 'undefined' || window.localStorage === undefined) return null
		  try {
		    const stored = Number(window.localStorage.getItem(COLUMN_KEY))
		    return Number.isFinite(stored) && stored > 0 ? stored : null
		  } catch {
		    /* A browser that refuses storage still has the width for the page it is on. */
		    return null
		  }
		}

		/** Remember the width, or shrug: the drag has already been honoured on screen either way. */
		function writeColumnWidth(pixels) {
		  if (typeof window === 'undefined' || window.localStorage === undefined) return
		  try {
		    window.localStorage.setItem(COLUMN_KEY, String(Math.round(pixels)))
		  } catch {
		    /* nothing to do — the width is on the page, which is where it is being used */
		  }
		}

		/** Forget it, so the next paint is the skin's own default again. */
		function forgetColumnWidth() {
		  if (typeof window === 'undefined' || window.localStorage === undefined) return
		  try {
		    window.localStorage.removeItem(COLUMN_KEY)
		  } catch {
		    /* as above */
		  }
		}

		/**
		 * The two controls he gets by clicking rather than by opening Settings.
		 *
		 * WHY THESE TWO, AND WHY ICONS. The product already has both — Appearance sets the theme
		 * and the content font size — but they live three clicks deep in a settings page he never
		 * opens mid-lesson. Reading a lesson is exactly when he wants a size or a dark room, so
		 * both are one click from the session header.
		 *
		 * WHY THE STEPS ARE NOT THE VAULT'S READING SIZES. `theme.setFontSize` accepts only an
		 * INTEGER between 12 and 17, and the vault's own reading sizes (15, 16.5, 18.5) are
		 * neither. Those belong to Obsidian, where the plugin sets its own CSS; here the product
		 * owns the axis, so this control steps inside it rather than fighting it. The three steps
		 * are the ones with room to differ: 13, 15, 17.
		 */
		const THEME_STEPS = ['light', 'dark', 'system']
		const SIZE_STEPS = [13, 15, 17]

		/** What each theme preference is called on screen. */
		const THEME_LABEL = { light: 'light', dark: 'dark', system: 'matching the system' }

		/** One stroke drawing, sized to the header's other utilities. */
		function icon(children) {
		  return React.createElement(
		    'svg',
		    {
		      viewBox: '0 0 16 16',
		      fill: 'none',
		      stroke: 'currentColor',
		      strokeWidth: 1.4,
		      strokeLinecap: 'round',
		      strokeLinejoin: 'round',
		      'aria-hidden': 'true',
		    },
		    children,
		  )
		}

		/** The mark for the theme currently in force: a sun, a moon, or a half-lit disc. */
		function themeIcon(preference) {
		  if (preference === 'light') {
		    return icon([
		      React.createElement('circle', { key: 'c', cx: 8, cy: 8, r: 3.2 }),
		      React.createElement('path', { key: 'r', d: 'M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1' }),
		    ])
		  }
		  if (preference === 'dark') {
		    return icon([React.createElement('path', { key: 'm', d: 'M13 10.2A5.7 5.7 0 0 1 5.8 3a5.9 5.9 0 1 0 7.2 7.2z' })])
		  }
		  return icon([
		    React.createElement('circle', { key: 'c', cx: 8, cy: 8, r: 5.6 }),
		    React.createElement('path', { key: 'h', d: 'M8 2.4a5.6 5.6 0 0 1 0 11.2z', fill: 'currentColor', stroke: 'none' }),
		  ])
		}

		/**
		 * The header control: one click for the theme, one for the text size.
		 *
		 * It reads the theme service rather than keeping a copy, so it cannot disagree with the
		 * Appearance page — setting the size there moves this label, and vice versa. The
		 * subscription is to `theme/change`, which the runtime emits on every accepted write.
		 *
		 * @param props - composed slot props; `theme` is injected by the registration below.
		 * @returns the control group.
		 */
		function MimirControls(props) {
		  /* Normalised to undefined so one guard covers both "no prop" and "skin is off". */
		  const controls = props?.theme ?? activeTheme ?? undefined
		  /* Both hooks run before the guard, because a hook cannot be skipped — and both are
		     written to survive an absent service rather than trusting the inject to have run. */
		  const [snapshot, setSnapshot] = React.useState(() => (controls === undefined ? null : controls.read()))

		  React.useEffect(() => {
		    if (controls === undefined) return undefined
		    return controls.watch(() => setSnapshot(controls.read()))
		  }, [])

		  if (controls === undefined) return null
		  const preference = snapshot?.preference ?? 'system'
		  const size = typeof snapshot?.fontSize === 'number' ? snapshot.fontSize : 15

		  const nextTheme = THEME_STEPS[(THEME_STEPS.indexOf(preference) + 1) % THEME_STEPS.length]
		  /* Step up through the ladder, then round again — so the control never needs a direction
		     and never lands on a size the product would refuse. */
		  const nextSize = SIZE_STEPS.find((step) => step > size) ?? SIZE_STEPS[0]

		  /* Which dot is lit: the step in force, or the nearest step when the size sits between
		     two of them. Ties go to the lower step, so a size never lights a dot above itself. */
		  const activeStep = SIZE_STEPS.reduce(
		    (best, step, index) => (Math.abs(step - size) < Math.abs(SIZE_STEPS[best] - size) ? index : best),
		    0,
		  )

		  return React.createElement(
		    'div',
		    { className: 'mm-controls' },
		    React.createElement(
		      'button',
		      {
		        type: 'button',
		        className: 'mm-icon',
		        key: 'theme',
		        title: `Theme: ${THEME_LABEL[preference] ?? preference} — click for ${THEME_LABEL[nextTheme]}`,
		        'aria-label': `Theme: ${THEME_LABEL[preference] ?? preference}. Click for ${THEME_LABEL[nextTheme]}.`,
		        onClick: () => controls.setTheme(nextTheme),
		      },
		      themeIcon(preference),
		    ),
		    React.createElement(
		      'button',
		      {
		        type: 'button',
		        className: 'mm-icon',
		        key: 'size',
		        title: `Text size: ${size}px — click for ${nextSize}px`,
		        'aria-label': `Text size: ${size} pixels. Click for ${nextSize} pixels.`,
		        onClick: () => controls.setSize(nextSize),
		      },
		      React.createElement('span', { className: 'mm-icon__a mm-icon__a--small', key: 'a1' }, 'A'),
		      /* The second A is drawn AT the size in force, so the icon itself answers "where am
		         I?" before anything is read — 13, 15 and 17 are 11px, 13px and 15px of letter. */
		      React.createElement(
		        'span',
		        { className: 'mm-icon__a', key: 'a2', style: { fontSize: `${11 + (size - SIZE_STEPS[0])}px` } },
		        'A',
		      ),
		      /* THREE DOTS, NOT THE NUMBER. Three steps, one dot each, the one in force filled —
		         a state read at a glance rather than a figure that has to be compared against a
		         remembered range. The number itself is still in the title for anyone who wants it.
		         A size that is on the product's axis but not on this ladder (14, say, which is the
		         default) marks the NEAREST step, because a control showing no state at all is
		         worse than one showing the step it is next to. */
		      React.createElement(
		        'span',
		        { className: 'mm-icon__dots', key: 'dots' },
		        SIZE_STEPS.map((step, index) =>
		          React.createElement('span', {
		            key: String(step),
		            className: 'mm-icon__dot',
		            'data-on': index === activeStep ? 'true' : undefined,
		          }),
		        ),
		      ),
		    ),
		  )
		}

		/**
		 * The startup piece, as the two surfaces here consume it.
		 *
		 * THE ASSETS ARE THE VAULT'S OWN. `Tools/splash/` holds the copies the Obsidian plugin plays,
		 * put there by the video pipeline and checksummed in the README beside them. Playing a second
		 * render for the app would be a second source for one piece of art, so the skin reads the
		 * same files — and it reads them the way the product's own document preview does, through
		 * `remote.workspaceFiles`, rather than by growing a host route to serve static bytes.
		 *
		 * THE GROUND IS MEASURED, NOT ASSUMED. The two builds are not the same object: the light one
		 * is an alpha layer whose edge misses its own paper by half a unit, and the dark one is an
		 * ADDITIVE GLOW that never reaches zero alpha and carries a blue wash — compositing it over
		 * anything but the ground it was rendered on leaves a visible rectangle. Those two grounds
		 * are in the splash README, measured from the master's outer band, and they are what the
		 * curtain is painted before the first frame arrives.
		 */
		const SPLASH = {
		  dark: {
		    video: 'Tools/splash/mimir_startup_dark.mp4',
		    poster: 'Tools/splash/mimir_startup_dark_poster.png',
		    type: 'video/mp4',
		    ground: '#040106',
		  },
		  light: {
		    video: 'Tools/splash/mimir_startup_light.webm',
		    poster: 'Tools/splash/mimir_startup_light_poster.png',
		    type: 'video/webm',
		    ground: '#d2cad7',
		  },
		}

		/** How long the last frame is held before the curtain lifts. */
		const SPLASH_STILL_MS = 1500

		/**
		 * The longest the curtain may stay if the clip never reports its own end.
		 *
		 * `ended` is the clock — the piece knows how long it is — and this is only the answer to a
		 * file that failed to decode, a codec the build cannot play, or a tab that was backgrounded
		 * mid-playback. A curtain that never lifts is worse than one that lifts early.
		 */
		const SPLASH_CEILING_MS = 15000

		/** The build that matches a colour scheme, and the only place that choice is made. */
		function splashBuildFor(colorScheme) {
		  return colorScheme === 'dark' ? SPLASH.dark : SPLASH.light
		}

		/**
		 * Whether the piece should play for this session.
		 *
		 * ONCE PER SESSION, AND AT ITS START RATHER THAN ON EVERY VISIT. A session with no turns yet
		 * is at its start; an older snapshot shape that does not carry the flag is treated as a
		 * start, because being greeted once too often is a smaller failure than never being greeted
		 * at all. The played set is the other half: even a blank session is greeted only once per
		 * page, so switching back and forth cannot turn an arrival into a tic.
		 *
		 * @param played - sessions already greeted on this page.
		 * @param sessionId - the session on screen.
		 * @param blank - whether that session has no turns yet, when the snapshot says.
		 * @returns whether to play.
		 */
		function shouldSplash(played, sessionId, blank) {
		  if (typeof sessionId !== 'string' || sessionId.length === 0) return false
		  if (played.has(sessionId)) return false
		  return blank !== false
		}

		/**
		 * The curtain: the piece on its own ground, over everything, gone when it ends.
		 *
		 * It holds the still frame for a beat after the clip stops, because cutting straight from a
		 * moving image to the interface reads as a glitch rather than an arrival. Under reduced
		 * motion it never plays: the poster is shown, held, and lifted — the piece is decorative and
		 * nobody should have to sit through motion they asked not to see.
		 *
		 * @param props - the resolved sources, the ground, the scheme and the way out.
		 * @returns the curtain.
		 */
		function SplashCurtain(props) {
		  const { video, poster, ground, reduced, onDone } = props

		  React.useEffect(() => {
		    const ceiling = setTimeout(onDone, reduced ? SPLASH_STILL_MS : SPLASH_CEILING_MS)
		    return () => clearTimeout(ceiling)
		  }, [])

		  /** The clip finished: hold the last frame, then lift. */
		  const settle = () => {
		    setTimeout(onDone, SPLASH_STILL_MS)
		  }

		  return React.createElement(
		    'div',
		    { className: 'mm-splash', style: { backgroundColor: ground }, 'aria-hidden': 'true' },
		    React.createElement('img', {
		      className: 'mm-splash__still',
		      src: poster,
		      alt: '',
		      'data-playing': reduced ? undefined : 'true',
		    }),
		    reduced
		      ? null
		      : React.createElement('video', {
		          className: 'mm-splash__clip',
		          src: video,
		          poster,
		          autoPlay: true,
		          muted: true,
		          playsInline: true,
		          onEnded: settle,
		          onError: onDone,
		        }),
		  )
		}

		/**
		 * The mark the hero shows before the headline of a new session.
		 *
		 * IT REPLACES THE SHIPPED ONE, which is the point: `conversation.hero.brand.mark` is a single
		 * occupant, so this is not an addition beside the product's mark but the mark itself — and
		 * because the whole skin is gated, a session that is not a lesson keeps its own.
		 *
		 * Mannaz (ᛗ, U+16D7) is the rune for the human, *maðr*, which is what the teacher's turns are
		 * signed with in this vault. The product hands its mark a square edge and a class that keeps
		 * the surrounding geometry, so both are honoured rather than reinvented.
		 *
		 * @param props - the requested edge in pixels, and the host's geometry class.
		 * @returns the mark.
		 */
		function MimirHeroMark(props) {
		  const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 34
		  return React.createElement(
		    'span',
		    {
		      className: props?.className,
		      'aria-hidden': 'true',
		      style: {
		        display: 'grid',
		        placeItems: 'center',
		        width: `${size}px`,
		        height: `${size}px`,
		        color: 'var(--mm-mark)',
		        fontFamily: 'var(--mm-serif)',
		        fontSize: `${Math.round(size * 0.82)}px`,
		        lineHeight: 1,
		        userSelect: 'none',
		      },
		    },
		    '\u16d7',
		  )
		}

		/**
		 * The preset this skin belongs to, and the whole of its scope.
		 *
		 * A preset's id is its directory name, so this is the `mimir-tutor` directory under the
		 * harness' `.agent-presets/`. The session header records it, the client surfaces it as a
		 * session projection, and that is what decides whether any of this is on.
		 *
		 * WHY SCOPING IS NOT COSMETIC. A client plugin composes for the PAGE, not for a
		 * conversation: its token layer is a layer over `<body>`, and a slot key it claims is
		 * claimed everywhere. So a skin that did not check would repaint every session in the app
		 * in the vault's colours — including the ones that are not lessons — and would replace the
		 * product's own question card in sessions that are not lessons at all. Both are wrong, and
		 * both are invisible until someone opens a session that is not a lesson.
		 */
		const PRESET = 'mimir-tutor'

		/**
		 * The agent preset recorded for one session, or undefined when there is none to read.
		 *
		 * Read through the same projection the product's own preset label reads, so this cannot
		 * disagree with what the interface says the session is.
		 *
		 * @param sessions - the client `sessions` service.
		 * @param sessionId - the session to ask about.
		 * @returns the preset id, or undefined.
		 */
		function presetOf(sessions, sessionId) {
		  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
		  const state = sessions?.list?.getSnapshot?.()
		  const value = state?.byId?.[sessionId]?.projectionValues?.agentPreset
		  return typeof value === 'string' ? value : undefined
		}

		/** Whether a session has no turns yet, when the list snapshot says so. */
		function blankOf(sessions, sessionId) {
		  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
		  const state = sessions?.list?.getSnapshot?.()
		  const blank = state?.byId?.[sessionId]?.blank
		  return typeof blank === 'boolean' ? blank : undefined
		}

		/** Required services: the theme layer, the slots, the session list, and the workspace reader. */
		const inject = ['theme', 'slots', 'sessions', 'remote']

		/**
		 * Read one vault file into a URL the page can play.
		 *
		 * THE COMPLETE READ, NOT THE PAGED ONE, and that distinction is the whole of a silent
		 * failure. The workspace reader has two calls: `read` returns a PAGE, sized by the Host's
		 * configured cap, and `readAll` returns the bytes. Asking for a page of a megabyte of video
		 * returns a decodable-looking prefix of it, the player rejects it, and the curtain's own
		 * error path lifts it — so the piece never appeared while every part of it behaved as
		 * written. The product's own document preview draws the same line: `read` for the text it
		 * pages through, `readAll` for a document it must hand over whole.
		 *
		 * @param remote - the client Remote carrying the `workspaceFiles` namespace.
		 * @param sessionId - the session whose workspace is the vault.
		 * @param path - vault-relative path.
		 * @param type - the media type the blob should claim.
		 * @returns an object URL for the bytes.
		 */
		async function blobUrlOf(remote, sessionId, path, type) {
		  const result = await remote.workspaceFiles.readAll(sessionId, path, undefined)
		  const value = result?.ok === true ? result.value : undefined
		  if (value === undefined || typeof value.data !== 'string') {
		    throw new Error(`no bytes read for ${path}`)
		  }
		  const binary = atob(value.data)
		  const bytes = new Uint8Array(binary.length)
		  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
		  return URL.createObjectURL(new Blob([bytes], { type }))
		}

		/**
		 * Stack the Mimir token layer over the active theme, and own the two rows — but only while
		 * the session on screen is a Mimir lesson.
		 *
		 * THE WHOLE SKIN IS ONE SWITCH. Engagement is a single list of disposers: the token layer,
		 * the stylesheet, and the two slot claims. Dropping that list is what turns the skin off,
		 * so there is no partial state to get wrong and switching sessions cannot strand half of
		 * it. The layer is asked for only when it is wanted, which also matters for the theme
		 * registry: an override nobody disposed is an override that outlives its reason.
		 *
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
		  const sessions = ctx.get('sessions')
		  /** The live disposers while the skin is on, or null while it is off. */
		  let engaged = null
		  /** The transcript box the skin has named as the scroller, or null when it has named none. */
		  let anchored = null
		  /** Whether this engagement has spent its fast search yet, so the tick cannot restart it. */
		  let chased = false
		  /** Frames left in that search; the box is looked for on each one. */
		  let framesToChase = 0
		  /** The draggable seam between the two columns, or null while this page has not put one in. */
		  let grip = null
		  /** The sessions this page has already greeted. */
		  const greeted = new Set()

		  /**
		   * Play the startup piece once, over everything, and take it away.
		   *
		   * IT IS MOUNTED OUTSIDE THE SLOTS, on its own node on `body`, because it is not part of any
		   * surface — it is the moment before the surfaces. It reads the build that matches the
		   * colour scheme in force and paints the ground that build was rendered on before a single
		   * frame has arrived. Every failure path lifts the curtain: a piece that cannot be read, a
		   * codec that cannot play, a video that never ends. None of them may leave him looking at a
		   * curtain instead of his lesson.
		   *
		   * @param sessionId - the session being greeted; its workspace holds the assets.
		   */
		  const greet = async (sessionId) => {
		    if (typeof document === 'undefined') return
		    const remote = ctx.get('remote')
		    if (remote === undefined || remote.workspaceFiles === undefined) return

		    const build = splashBuildFor(ctx.theme?.getTheme?.()?.active?.colorScheme)
		    const mount = document.createElement('div')
		    mount.setAttribute('data-mimir-splash', '')
		    document.body.append(mount)
		    const root = createRoot(mount)
		    const created = []
		    let lifted = false

		    const lift = () => {
		      if (lifted) return
		      lifted = true
		      try {
		        root.unmount()
		      } catch {
		        /* an unmount that fails must still free the node and the URLs */
		      }
		      mount.remove()
		      for (const url of created) {
		        try {
		          URL.revokeObjectURL(url)
		        } catch {
		          /* already gone */
		        }
		      }
		    }

		    try {
		      const [video, poster] = await Promise.all([
		        blobUrlOf(remote, sessionId, build.video, build.type),
		        blobUrlOf(remote, sessionId, build.poster, 'image/png'),
		      ])
		      created.push(video, poster)
		      const reduced =
		        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
		      root.render(
		        React.createElement(SplashCurtain, {
		          video,
		          poster,
		          ground: build.ground,
		          reduced,
		          onDone: lift,
		        }),
		      )
		    } catch (error) {
		      note(`the startup piece was not played: ${String(error?.message ?? error)}`)
		      lift()
		    }
		  }

		  const disengage = () => {
		    if (engaged === null) return
		    const closing = engaged
		    engaged = null
		    activeTheme = null
		    releaseScrollName()
		    releaseGrip()
		    chased = false
		    framesToChase = 0
		    for (const dispose of closing) {
		      try {
		        dispose()
		      } catch {
		        /* one disposer that fails must not strand the rest of the list */
		      }
		    }
		  }

		  /**
		   * Give the element that actually scrolls the name the product scrolls by.
		   *
		   * THE PRODUCT RESOLVES ITS SCROLL TARGET BY NAME, NOT BY GEOMETRY. The chat takes the
		   * nearest ancestor carrying `data-conversation-scroll` and scrolls that one — for
		   * follow-the-newest-message, for the scroll position it remembers and restores when the
		   * session is opened, for the paging anchor, for the wheel at the end of the transcript
		   * and for the scroll-to-bottom control. The stylesheet above moves the scrolling INSIDE
		   * the session slot, which leaves the named element with nothing to scroll: measured on
		   * 2026-09-19, a freshly loaded page sat at scrollTop 0 of a 6582px transcript, and two
		   * new turns moved the height and not the position. The session opened at its oldest
		   * message and stayed there.
		   *
		   * So the box that scrolls wears the same name as well. It is an empty attribute with no
		   * declaration of its own anywhere, every product rule that reads it is a descendant
		   * selector that already matched through the wrapper, and the one lookup whose answer
		   * changes is `closest()` called from a row — which is precisely the lookup that was
		   * pointing at the wrong element. It is removed again when the skin lets go.
		   */
		  function nameTheScroller() {
		    if (typeof document === 'undefined') return null
		    const box = document.querySelector('[data-phase="active"] [data-conversation-scroll] > [data-slot="conversation.session"] > *')
		    if (box === anchored) return box
		    releaseScrollName()
		    if (box === null) return null
		    if (box.getAttribute('data-conversation-scroll') === null) box.setAttribute('data-conversation-scroll', '')
		    anchored = box
		    return box
		  }

		  /** Take the name back off the element the skin wrote it on, and nothing else. */
		  function releaseScrollName() {
		    if (anchored === null) return
		    const box = anchored
		    anchored = null
		    if (box.getAttribute('data-conversation-scroll') === '') box.removeAttribute('data-conversation-scroll')
		  }

		  /**
		   * Write the width onto the row — the one copy the column's basis and the seam's own `left`
		   * both read, so a drag can never leave the boundary and the column disagreeing.
		   *
		   * @param row - the element the two columns are laid out in.
		   * @param pixels - the width to apply, or null to put the skin's own default back.
		   */
		  function setColumnWidth(row, pixels) {
		    if (row === null) return null
		    if (pixels === null) {
		      row.style.removeProperty('--mm-column')
		      forgetColumnWidth()
		      return null
		    }
		    /* THE ROW IS READ AS ITS LAYOUT WIDTH, NOT AS ITS BORDER BOX. It reserves a scrollbar
		       gutter — the product sets scrollbar-gutter: stable — and that reserved strip is not
		       space the two columns can use: measured off the border box, the floor this rule
		       promises the transcript came out eight pixels short of it. clientWidth is the box the
		       flex items are actually laid out in. */
		    const width = clampColumn(pixels, row.clientWidth)
		    row.style.setProperty('--mm-column', `${width}px`)
		    return width
		  }

		  /**
		   * The seam's own pixels, for the accessibility tree: a separator with a value is a control a
		   * screen reader can report, and a separator without one is a mystery.
		   *
		   * @param gripEl - the seam.
		   */
		  function announceColumn(gripEl) {
		    const row = gripEl.parentElement
		    if (row === null) return
		    const rowWidth = row.clientWidth
		    const seat = row.querySelector('[data-composer-seat]')
		    const now = seat === null ? COLUMN_MIN : Math.round(seat.getBoundingClientRect().width)
		    gripEl.setAttribute('aria-valuenow', String(now))
		    gripEl.setAttribute('aria-valuemin', String(COLUMN_MIN))
		    gripEl.setAttribute('aria-valuemax', String(clampColumn(COLUMN_MAX, rowWidth)))
		  }

		  /**
		   * Drag the seam.
		   *
		   * POINTER CAPTURE RATHER THAN WINDOW LISTENERS, and the move is coalesced into a frame: a
		   * pointer that reports faster than the display refreshes must not make the browser lay the
		   * two columns out more often than anyone can see. The width is computed from the pointer's
		   * own origin each time rather than accumulated, so a drag held against either end comes back
		   * exactly under the pointer when it turns round. The width is written on every frame and
		   * REMEMBERED only at the end — a drag that is abandoned mid-way leaves the last width it
		   * showed, which is what he was looking at when he let go.
		   *
		   * @param event - the pointerdown on the seam.
		   */
		  function onGripDown(event) {
		    const gripEl = event.currentTarget
		    const row = gripEl.parentElement
		    if (row === null) return
		    if (event.pointerType === 'mouse' && event.button !== 0) return
		    event.preventDefault()
		    gripEl.setPointerCapture(event.pointerId)
		    gripEl.setAttribute('data-dragging', 'true')
		    const origin = event.clientX
		    const rowWidth = row.clientWidth
		    const seat = row.querySelector('[data-composer-seat]')
		    const startedAt = seat === null ? COLUMN_MIN : seat.getBoundingClientRect().width
		    let latest = origin
		    let frame = null
		    const paint = () => {
		      frame = null
		      setColumnWidth(row, startedAt - (latest - origin))
		      announceColumn(gripEl)
		    }
		    const onMove = (move) => {
		      latest = move.clientX
		      if (frame === null) frame = requestAnimationFrame(paint)
		    }
		    const onUp = () => {
		      if (frame !== null) {
		        cancelAnimationFrame(frame)
		        frame = null
		      }
		      paint()
		      const width = clampColumn(startedAt - (latest - origin), rowWidth)
		      writeColumnWidth(width)
		      gripEl.removeAttribute('data-dragging')
		      gripEl.removeEventListener('pointermove', onMove)
		      gripEl.removeEventListener('pointerup', onUp)
		      gripEl.removeEventListener('pointercancel', onUp)
		    }
		    gripEl.addEventListener('pointermove', onMove)
		    gripEl.addEventListener('pointerup', onUp)
		    gripEl.addEventListener('pointercancel', onUp)
		  }

		  /**
		   * The seam from the keyboard: arrows by 16, with shift by 48, Home and End to the ends, and
		   * Enter to put it back. A separator that only a pointer can move is a separator half the
		   * readers cannot use — and this one is a WIDTH, so the keys are the horizontal ones and
		   * left, which widens the column, is the direction the seam itself moves.
		   *
		   * @param event - the keydown on the seam.
		   */
		  function onGripKey(event) {
		    const gripEl = event.currentTarget
		    const row = gripEl.parentElement
		    if (row === null) return
		    const seat = row.querySelector('[data-composer-seat]')
		    const current = seat === null ? COLUMN_MIN : seat.getBoundingClientRect().width
		    const step = event.shiftKey ? 48 : 16
		    if (event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') {
		      event.preventDefault()
		      setColumnWidth(row, null)
		      requestAnimationFrame(() => announceColumn(gripEl))
		      return
		    }
		    let wanted = null
		    if (event.key === 'ArrowLeft') wanted = current + step
		    else if (event.key === 'ArrowRight') wanted = current - step
		    else if (event.key === 'Home') wanted = COLUMN_MIN
		    else if (event.key === 'End') wanted = COLUMN_MAX
		    if (wanted === null) return
		    event.preventDefault()
		    const width = setColumnWidth(row, wanted)
		    announceColumn(gripEl)
		    if (width !== null) writeColumnWidth(width)
		  }

		  /**
		   * Put the seam on the row, and keep it there.
		   *
		   * THE PRODUCT DRAWS ITS OWN WIDTH HANDLES AND THEY ARE NOT THIS ONE. Its pair adjusts the
		   * transcript's content width — `dsh.conversation.contentWidth`, floor 640 — inside the left
		   * column, and it hides both of them the moment a question is pending, which is exactly when
		   * the composer wants room. This is the boundary BETWEEN the two columns, which the product
		   * has no concept of. It is a child of the row rather than of the column because the column
		   * scrolls its own content, which would carry the strip away, and clips it, which would cut
		   * it; and it is installed on the same pass that names the scroller, so a re-render that
		   * replaces the row gets it back without anything having to notice.
		   *
		   * @returns the seam, or null while there is no conversation on screen.
		   */
		  function installGrip() {
		    if (typeof document === 'undefined') return null
		    const row = document.querySelector('[data-phase="active"] [data-conversation-scroll]:has(> [data-composer-seat])')
		    if (row === null) {
		      grip = null
		      return null
		    }
		    if (grip !== null && grip.parentElement === row) return grip
		    const el = document.createElement('div')
		    el.className = 'mm-grip'
		    el.setAttribute('data-mimir-grip', '')
		    el.setAttribute('role', 'separator')
		    el.setAttribute('aria-orientation', 'vertical')
		    el.setAttribute('tabindex', '0')
		    el.setAttribute('aria-label', 'Width of the lesson column. Drag it, or use the arrow keys; press Enter to put it back.')
		    el.addEventListener('pointerdown', onGripDown)
		    el.addEventListener('keydown', onGripKey)
		    el.addEventListener('dblclick', () => {
		      setColumnWidth(row, null)
		      requestAnimationFrame(() => announceColumn(el))
		    })
		    row.append(el)
		    grip = el
		    const stored = readColumnWidth()
		    setColumnWidth(row, stored)
		    announceColumn(el)
		    return el
		  }

		  /** Take the seam, and the width it wrote, back off the product's row. */
		  function releaseGrip() {
		    if (grip === null) return
		    const row = grip.parentElement
		    grip.remove()
		    grip = null
		    if (row !== null) row.style.removeProperty('--mm-column')
		  }

		  /**
		   * Chase the box for a moment after the skin comes on, rather than waiting for the slow pass.
		   *
		   * IT IS A RACE, AND IT WAS BEING LOST. The chat scrolls a session to its newest turn in the
		   * same frame it mounts — `toBottom(scrollerOf(list))`, resolving the name by walking up from
		   * its list — and the name is written by this script. Written on the skin's three-quarter-
		   * second pass, it lands after that lookup has already returned the wrapper, which has
		   * nothing to scroll: measured 2026-09-19 with everything else identical, one load opened at
		   * the foot and the next at scrollTop 0 of a 7258px transcript, and a fresh page opened at
		   * the top every time the chat mounted before the pass came round. So the frames right after
		   * an engagement are spent looking, and the search ends the moment it succeeds — the slow
		   * pass stays as the long tail, for a box that is replaced later.
		   */
		  function chaseTheScroller() {
		    if (framesToChase <= 0 || anchored !== null) {
		      framesToChase = 0
		      return
		    }
		    framesToChase -= 1
		    nameTheScroller()
		    installGrip()
		    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(chaseTheScroller)
		  }

		  /**
		   * Build the skin, one seat at a time.
		   *
		   * THE LIST IS ASSIGNED BEFORE ANYTHING IS BUILT, and this is the whole of the bug it
		   * replaces. Engaged used to be one array literal, and an array literal is evaluated
		   * before it is assigned: when the LAST element — the header control — threw, the first
		   * element had already been applied and its disposer was now unreachable, because the
		   * assignment never happened and `engaged` was still null. So the token layer stayed on
		   * for the life of the page with nothing able to remove it, and every registration after
		   * the failure was simply missing. Two symptoms, one cause, and neither of them said so.
		   *
		   * So: assign first, build second, and take each disposer on its own. One seat that
		   * refuses to register now costs exactly that seat — and it is recorded, because a skin
		   * that is missing a control should say which one and why.
		   */
		  const engage = () => {
		    if (engaged !== null) return
		    const live = []
		    engaged = live
		    activeTheme = {
		      read: () => ctx.theme.getTheme(),
		      watch: (listener) => {
		        const off = ctx.on('theme/change', listener)
		        return typeof off === 'function' ? off : () => {}
		      },
		      setTheme: (id) => ctx.theme.setTheme(id),
		      setSize: (px) => ctx.theme.setFontSize(px),
		    }

		    const take = (seat, build) => {
		      try {
		        const dispose = build()
		        if (typeof dispose === 'function') live.push(dispose)
		      } catch (error) {
		        note(`${seat} could not be registered: ${String(error?.message ?? error)}`)
		      }
		    }

		    take('the palette', () => ctx.theme.overrideTokens(SOURCE, tokensFor(MIMIR)))
		    take('the stylesheet', () => installStyles())
		    take('the board row', () =>
		      ctx.slots.inject('tool.call.toolview', () =>
		        ctx.slots.register({ name: 'tool.call.toolview', key: 'mimir_board' }, BoardRow),
		      ),
		    )
		    take('the question record', () =>
		      ctx.slots.inject('tool.call.toolview', () =>
		        ctx.slots.register({ name: 'tool.call.toolview', key: 'ask_user_question' }, AskedRow),
		      ),
		    )
		    take('the header control', () =>
		      ctx.slots.inject('conversation.session.header.utilities', () =>
		        ctx.slots.register(
		          { name: 'conversation.session.header.utilities', id: 'mimir-controls', order: 40 },
		          MimirControls,
		        ),
		      ),
		    )
		    take('the hero mark', () =>
		      ctx.slots.inject('conversation.hero.brand.mark', () =>
		        ctx.slots.register({ name: 'conversation.hero.brand.mark' }, MimirHeroMark),
		      ),
		    )
		  }

		  /**
		   * Follow the session on screen.
		   *
		   * The decision is recorded on the bundle's breadcrumb, because "why is the skin off?" is
		   * otherwise unanswerable from the interface — the Lesson pane carried a build marker for
		   * exactly this reason. `window.__MIMIR_SKIN__.preset` names the preset that was read, so
		   * a skin that is off says which session turned it off instead of saying nothing.
		   */
		  const sync = () => {
		    const active = sessions?.list?.getSnapshot?.().current
		    const preset = presetOf(sessions, active)
		    if (typeof window !== 'undefined' && window.__MIMIR_SKIN__ !== undefined) {
		      window.__MIMIR_SKIN__.preset = preset ?? null
		      window.__MIMIR_SKIN__.engaged = preset === PRESET
		    }
		    if (preset === PRESET) {
		      engage()
		      /* A name written after the chat has already looked for it is a name written too late:
		         one fast search per engagement, and the slow pass after it. */
		      if (!chased) {
		        chased = true
		        framesToChase = 300
		        chaseTheScroller()
		      }
		      nameTheScroller()
		      installGrip()
		      if (shouldSplash(greeted, active, blankOf(sessions, active))) {
		        greeted.add(active)
		        greet(active)
		      }
		    } else disengage()
		  }

		  ctx.effect(() => {
		    const off = sessions.list.subscribe(sync)
		    sync()
		    /* THE SUBSCRIPTION IS THE MECHANISM; THIS IS THE SAFETY NET. The failure this guards
		       against is not subtle and it is not rare in a page that has been open a while: if the
		       list stops notifying — for any reason at all — the skin is left in whatever state the
		       last notification produced, and a skin stuck ON repaints every other preset's session
		       in the vault's colours. That is loud, and its cause is invisible. A slow re-read of an
		       in-memory snapshot costs nothing and makes the decision self-correcting, so the worst
		       case is a second of staleness rather than a session that never goes back.

		       Three quarters of a second, not a poll: `sync` is synchronous and reads a field. */
		    const tick = setInterval(sync, 750)
		    return () => {
		      if (typeof off === 'function') off()
		      clearInterval(tick)
		      disengage()
		    }
		  }, 'mimir-skin: follow the session on screen')
		}

		exports.apply = apply
		exports.AskedRow = AskedRow
		exports.askedOf = askedOf
		exports.BOARD_CSS = BOARD_CSS
		exports.BoardRow = BoardRow
		exports.boardOf = boardOf
		exports.clampColumn = clampColumn
		exports.COLUMN_KEY = COLUMN_KEY
		exports.COLUMN_MAX = COLUMN_MAX
		exports.COLUMN_MIN = COLUMN_MIN
		exports.forgetColumnWidth = forgetColumnWidth
		exports.inject = inject
		exports.MimirControls = MimirControls
		exports.MimirHeroMark = MimirHeroMark
		exports.PRESET = PRESET
		exports.presetOf = presetOf
		exports.readColumnWidth = readColumnWidth
		exports.shouldSplash = shouldSplash
		exports.SIZE_STEPS = SIZE_STEPS
		exports.SPLASH = SPLASH
		exports.splashBuildFor = splashBuildFor
		exports.SplashCurtain = SplashCurtain
		exports.THEME_STEPS = THEME_STEPS
		exports.tokensFor = tokensFor
		exports.TRANSCRIPT_MIN = TRANSCRIPT_MIN
		exports.writeColumnWidth = writeColumnWidth
		window.__MIMIR_SKIN__.applied = true;
		return module.exports;
	}
});
} catch (error) {
	window.__MIMIR_SKIN__.error = String(error && error.message ? error.message : error);
	throw error;
}
})();
