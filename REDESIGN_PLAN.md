# Funding Finder Mini App — Redesign Plan

Visual/design-system migration of the Telegram Mini App to match the redesigned landing page.

**Source of truth**
1. `funding-finder-landing.html` (canonical visual reference — every color, radius, shadow, and component shape traces back to it)
2. `funding-finder-miniapp-redesign-spec.md` (tokens, component mapping, Telegram Mini App technical requirements, "avoid AI-generic design" rules — all hard constraints)

**Non-negotiables from the spec:** no emoji as icons, no gradients (except the single hero glow), no drop shadows, 1px solid borders only, exactly three semantic risk colors, always dark/cobalt regardless of system theme, Inter for UI + JetBrains Mono for numbers only, 44px touch targets, press states not hover states, no fabricated numbers ever, calm not urgent.

**Scope discipline:** business logic, API calls, state management, and data flow do not change unless a section below explicitly says so. The calculator, live widget, track-record data, B2B/lead forms and referral flow are real, functioning infrastructure being re-skinned — not a prototype being rebuilt.

---

## STEP 1 — Audit of the current app

Stack: React 18 + TypeScript + Vite + Tailwind CSS 3 + react-router-dom 6. No icon library. No custom fonts loaded. Backend (Node/Express/Prisma) is out of scope.

### 1.1 Screens / routes (frontend/src/pages)

| Route | Page | Notes |
|---|---|---|
| `/` | `MainPage.tsx` | Scanner: exchange selector, capital input, scan button, sticky scan card, top-pick banner (gradient), search/sort/filter chips, result list (3 yield tiers), AI analysis + recommendations, risk profile modal, pair matrix |
| `/arbitrage` | `ArbitragePage.tsx` | 4 tabs: opportunities / alerts / spot-futures / heatmap. Filter bar, opportunity cards, alerts CRUD, profit calculator modal, backtest bars |
| `/portfolio` | `PortfolioPage.tsx` | 2 tabs: simulator (add/remove positions) / live (API keys, real positions, PnL KPIs, CSV export, auto-execute dialog) |
| `/profile` | `ProfilePage.tsx` | Balance/referral stats, usage dashboard, achievements grid (emoji), trial, referral share buttons, plan cards, payment/withdrawal history, QR login |
| `/settings` | `SettingsPage.tsx` | Accordion sections: notifications, pushover, default exchanges, filters, language, appearance, export/import |
| `/terms`, `/privacy` | `TermsPage.tsx`, `PrivacyPage.tsx` | Single static card each |
| `/admin` | `AdminPage.tsx` | Internal admin: stats cards (raw palette), user table, funnel table |
| `/qr-scan` | `QrScanPage.tsx` | OAuth redirect landing, 100% inline styles |
| `/public` | `PublicPage.tsx` | In-app landing: gradient hero, scan panel, rate tables, FAQ |
| `*` (web only) | `components/LoginPage.tsx` | Email/Google/Telegram/QR login card |
| overlay | `components/Onboarding.tsx` | Multi-step wizard + completion checklist |

### 1.2 Reusable UI components (frontend/src/components)

- **Buttons:** `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-refresh` / `.btn-success` / `.btn-danger` (index.css:259–311) — hover states only, no `:active`
- **Cards:** `.card` / `.card-flush` (index.css:234–257) — **with `box-shadow: var(--shadow)`** (spec violation)
- **Inputs:** `.input-field` (index.css:316–331); raw `<select>`, raw checkboxes/radios in Portfolio/Settings (spec violation)
- **Chips/badges:** `.chip` + `.chip-{success,brand,danger,warning}` (index.css:353–380); risk pills via `getRiskColor()` → raw Tailwind classes (`text-red-700 bg-red-100` etc., formatters.ts:36–43); persistence grades A–F → 5 raw color pairs (ArbitragePage.tsx:598–604)
- **Tabs:** segmented `btn-primary/btn-secondary` buttons (ArbitragePage, PortfolioPage); `SegmentedControl` in FilterBar; yield-filter chips (MainPage)
- **Modals:** PaywallModal (bottom sheet), CryptoCheckoutModal, QrLoginModal (uses **undefined classes** `.modal-overlay/.modal/.spinner`), RiskProfileModal, HistoryChart modal, ProfitCalculator modal, AutoExecuteDialog, alert-create dialog, ConfirmDialog, BottomSheet (dead code), ContextMenu
- **Toasts:** Toast.tsx — `bg-green-700/bg-red-600/bg-amber-800/bg-blue-600` + `shadow-lg` (spec violations)
- **States:** `Skeleton.tsx` (ResultSkeleton/CardSkeleton, `bg-gray-200`), `PageLoader` (App.tsx:490–496, `border-blue-500` spinner), empty states (emoji 🔍 ⏳ + muted text), error boundary (raw reds)
- **Other:** PullToRefresh, CountdownTimer (`bg-blue-500` fill), FundingCalendar, HistoryChart, PairMatrix, ExchangeSelector/ExchangeSelect (▴▾ glyphs, `shadow-lg` dropdown), FilterBar (🔧), QuickStart, ActivationChecklist (🔥 streak), TrialCTA (gradient banner), SoftPaywallBanner (gradient tint), InstallBanner, SpotFuturesPanel, Heatmap, LiquidationHeatmap, MarketDataTable (bypasses all tokens), LanguageSwitcher, WebHeader (web only), DebugLog (dev-only, 100% inline hex)

### 1.3 Icons — ALL emoji, zero real icons

- 60+ emoji usages across ~30 files (exact map below), plus text glyphs (✕ ✓ ▾ ▸ ▲ ↔ ↗ ⬇ ● ⧉ 𝕏)
- The **only** inline SVG in the codebase: `FundingSparkline` (MainPage.tsx:939–956), colored via `var(--green, #16a34a)` / `var(--red, #ef4444)`
- Nav tab icons: 📊 🔄 💼 👤 (Navigation.tsx:16–22)
- Full emoji inventory (char × count): →9 · 📊8 · ✓7 · ⭐7 · ✕6 · 🔔6 · ↗5 · 🔗4 · ▾4 · 💰4 · 🎁4 · 🚀3 · 💡3 · 📈3 · ✅3 · ⚡3 · 🔄3 · 💼3 · 👤3 · 🤖3 · 📱3 · 🔒3 · ⚠3 · 🔍3 · 🎉2 · 🔥2 · 📆2 · ☆2 · ❌2 · ▴2 · 🎯2 · 🧠2 · ●2 · ↔2 · 🌐2 · and 30+ single usages (🔷🔶🟡💠⬡◎🐞🔧🙈👁💎🌱▲▼🔁★↓▶←🔕🗑▸🖼⬇🏆🤝🏅📤✈💬○🏦🎨📦)

### 1.4 Colors & fonts actually in the code

- **Token system (index.css:12–83):** MD3-flavored `--brand:#1565C0` (with hover/soft/on-brand), `--success/--danger/--warning` (+soft), light `--bg:#FCFCFF/--surface/--surface-2/--text/--text-muted/--border`; a `.dark` re-map; a `:root.has-tg-theme` layer that binds `--tg-*` Telegram theme params. Plus **orphan tokens** used but never defined: `--green`, `--red`, `--amber`, `--line`.
- **Intercept layer (index.css:106–231):** remaps raw Tailwind classes (`.text-gray-400`, `.bg-white`, `.bg-green-50`, …) to tokens with `!important` for dark/light — a band-aid over raw classes, and it doesn't cover everything (gray-300/400 in ExchangeSelect/FilterBar/Onboarding, all of MarketDataTable's gray-700/800 palette).
- **Hardcoded hex in components:** brand gradient `#3390ec → #1f4fb0` (MainPage:241, ArbitragePage:279, ProfilePage:191, PublicPage:110; 3-stop in TrialCTA:151), `#ef4444` (ContextMenu:194, CryptoCheckoutModal:208, QrScanPage:103), `#dc2626` (PaywallModal:183/376, TrialCTA), `#16a34a`/`#b45309` (PaywallModal, TrialCTA, Onboarding), `#94a3b8`/`#0f172a` (QrScanPage, shareCard.ts), `#888…#9ca3af` (DebugLog).
- **Gradients — 14 sites, 4 patterns:** hardcoded brand gradient (4 files + TrialCTA), token gradient `var(--brand)→var(--brand-hover)` (MainPage:348 top-pick, ProfilePage:400 plan banner), rgba tint gradients (PaywallModal:148/179, SoftPaywallBanner:51, TrialCTA:70/72/128), one Tailwind gradient (PublicPage:256).
- **Shadows — 6 sites:** `shadow-2xl` (BottomSheet:82, ContextMenu:175), `shadow-lg` (ExchangeSelect:94, LoginPage:217, Toast:61), `shadow-[var(--shadow-lg)]` (ProfilePage:547), plus `.card` box-shadow (index.css:240/256) and CSS `--shadow/--shadow-lg` tokens.
- **Fonts:** none loaded. `fontFamily` fallback stack only (`-apple-system, …`, tailwind.config.js:20). `font-mono` used in ~6 files but resolves to Tailwind's default mono stack. No Inter, no JetBrains Mono anywhere.
- **Backdrop blur:** one allowed site — `.web-header` blur(6px) (index.css:571); spec permits header blur (10px per landing) and nothing more.

### 1.5 Navigation structure

- Bottom fixed tab bar (`.web-nav`, index.css:504–564): **Main / Arbitrage / Portfolio / Profile** — matches the spec's suggested tabs (Scanner/Portfolio/Alerts/Profile) in spirit; spec says keep existing nav, only re-skin. `padding-bottom: env(safe-area-inset-bottom)`; active tab `color: var(--brand)`; badge = `bg-red-500` bubble; no `--safe-top`/`--safe-bottom` handling.
- Sticky header: `MainPage` scan card uses `position: sticky; top: 0` with no safe-area padding.
- No drawer, no stack; only `react-router-dom` routes + modal overlays.
- Telegram init (useTelegram.ts): expand/requestViewport/disableVerticalSwipes/enableClosingConfirmation present; **no** `wa.ready()`, no `setBackgroundColor`, no `setHeaderColor`, no MainButton/SecondaryButton branding, no safe-area binding, no theme lockdown.

---

## STEP 2 — Gap analysis

### 2.1 Component mapping (spec table → app equivalent)

| Spec landing element | App equivalent | Work |
|---|---|---|
| `.dash` hero dashboard mockup | **MainPage (Scanner)** — KPI row + opportunity list | KPI strip does not exist yet → add using real data only (see 2.3); restructure result rows to the `.opp` pattern |
| `.opp` opportunity row | MainPage `ResultItem`, ArbitragePage `OpportunityCard`, watchlist/alerts rows | Rebuild as core list-item component: pair bold, route muted, annualized mono in `--green`, risk pill in `--green-soft/--amber-soft/--red-soft` |
| `.kpi` mini stat card | Portfolio KPI blocks (surface-2 boxes), new MainPage strip | Standardize: label `--text3` small, value mono bold |
| `.bcard` bento cards | Onboarding feature steps | Card shell + tokens; content stays (feature discovery) |
| `.calc` yield calculator | ArbitragePage profit calculator, PositionCalculator | Tokens + mono numbers; keep net-of-fees math and illustrative note |
| `.plan` pricing cards | ProfilePage `PlanCard`, PaywallModal plan compare | Featured plan = `--cobalt` **border** (no shadow); checkmarks in `--green` |
| checkbox/radio/select | SettingsPage toggles, Portfolio selects, AlertModal select, ExchangeSelect | Custom-drawn per spec; never raw browser defaults |
| bottom tab bar (fresh) | Navigation.tsx | Re-skin: `--bg1` bg, `border-top --border`, active `--cobalt-text`, inactive `--text3`, `calc(10px + var(--safe-bottom))` padding, real icons |

### 2.2 Required fixes (spec violations present today — not optional)

1. **Theme follows Telegram/system** — App.tsx:510–551 binds `--tg-*` params and toggles light/dark. Spec: always dark/cobalt; read `colorScheme` once for status bar only. **Required.**
2. **Emoji-as-icon everywhere** — all 60+ usages. **Required.**
3. **Gradients (14 sites)** — including hardcoded Telegram-blue brand gradient that doesn't even match any token. **Required.**
4. **Drop shadows (6 sites + `.card` + `--shadow` tokens)** — spec: none. **Required.**
5. **Fabricated number** — PaywallModal:90–93 `upgradeRate = 72 + random(20)` (fake "upgrade rate"), plus end-of-day UrgencyTimer and exit-intent offer. Spec principles #2 (no fabricated numbers, ever) + #3 (no artificial scarcity). **Required — user approved removal.**
6. **Urgency copy in i18n** — "unlock", "Limited time", "Wait — special offer just for you!", "risk-free", "before anyone else" (en.ts L214/326–328/433/671/679/880; mirrored in ru/tr/vi/hi/es). Spec: numeric, plain. **Required.**
7. **Hover-only interactions** — `.btn:hover`, `hover:bg-*` everywhere; no `:active` press states; `-webkit-tap-highlight-color` not disabled. **Required.**
8. **Raw Tailwind colors / raw browser form controls** — exhaustive list in §1.4/§1.5 of the audit; settings toggles, Portfolio selects, alert-modal select are unstyled browser controls. **Required.**
9. **Off-token brand color** — `--brand:#1565C0` vs spec `--cobalt:#3D63FF`; orphan `--green/--red/--amber/--line` tokens. **Required.**
10. **Risk/persistence color sprawl** — 5-grade persistence pills (A–F) + OI-signal 4-color text + break-even 3-color text. Spec: exactly three semantic colors for risk badges. Persistence grades become: A→`--green`, B→`--cobalt-text`, C→`--amber`, D→`--amber`, F→`--red` (flagged decision, defaulting to this mapping).
11. **No fonts loaded** — spec requires Inter (UI) + JetBrains Mono (numbers). **Required.**
12. **Telegram technical layer missing** — safe areas, `ready()`, background/header color, native button branding. **Required.**

### 2.3 Data-honesty flags (no fabricated numbers)

- New MainPage KPI strip needs real values: "exchanges tracked" and "pairs in scan" exist on the landing widget API (`/api/public/arbitrage` returns `exchangesTracked`/`pairsTracked`); the app's `/arbitrage/opportunities` response shape is not guaranteed to include them — **verify the field; if absent, derive honestly** (exchanges = `selectedExchanges.length`, pairs = `scanResults.scanned` from the last scan, "fee to view" = "0%" from plan config) or show `—` (honest empty state). Never invent.
- Paywall "upgrade rate" removal is part of the fix above.

### 2.4 User decisions received (no spec equivalent — settled)

| Item | Decision |
|---|---|
| Icon set | **Add `lucide-react`** — one set, one stroke width (2px wrapper), one corner style |
| Achievements + ActivationChecklist gamification | **Keep features, re-skin** with real icons + tokens (streak badge stays but tokenized) |
| PaywallModal urgency (fake rate, timer, exit offer) | **Remove** |
| AdminPage / DebugLog / QrScanPage / MarketDataTable | **Re-skin all with tokens** |
| PublicPage | **Re-skin with tokens** (no hero glow — the glow exception belongs to the landing hero only) |

---

## STEP 3 — Phased execution plan

Working method per phase: implement → `npm run typecheck` + `npm run lint` + `npm run build` (+ `npm run test`) → self-check against the spec checklist → **stop and report** before the next phase.

**Never touch:** `backend/` entirely; `frontend/public/landing*.html`, `embed.html`, `embed.js` (marketing pages); `frontend/src/utils/{analytics,logger,plans,profitCalc,funding,exchanges,shareLinks}.ts` (logic); `frontend/src/hooks/{useWebSocket,useIsWide}.ts`; `frontend/src/api/client.ts`; `frontend/src/i18n/index.tsx` (infra — dict files only in Phase 10); `frontend/vite.config.ts`, `sw.js`, `scripts/`, `gen-seo.mjs`; dead code `BottomSheet.tsx` + `PositionCalculator.tsx` (unimported — left as-is).

---

### Phase 0 — Global tokens, fonts, theme lockdown
*Foundation only. Sets every token the rest of the plan consumes.*

Files (6):
1. `frontend/index.html` — Google Fonts: preconnect + Inter 400–800 + JetBrains Mono 500/700 (`display=swap`, non-blocking, same as landing); `theme-color` → `#05070C`
2. `frontend/tailwind.config.js` — `fontFamily.sans` → Inter stack, `fontFamily.mono` → JetBrains Mono stack
3. `frontend/src/index.css` — **replace the token block** with spec tokens: `--bg:#05070C`, `--bg1:#0B0F17`, `--card:#12161F`, `--border:#1E2430`, `--border-2:#2A3140`, `--cobalt:#3D63FF`, `--cobalt-text:#8FA5FF`, `--green:#34D399`, `--red:#F87171`, `--amber:#FBBF24`; add derived softs from the landing: `--cobalt-soft:#16204A`, `--green-soft:#0F2A21`, `--red-soft:#2E1518`, `--amber-soft:#2B2210`, plus `--text:#EDEFF5`, `--text2:#8891A3`, `--text3:#5B6272`. **Delete** light theme, `.dark`, `has-tg-theme` layers and the entire intercept layer (L106–231). Keep `--brand/--success/--danger/--warning` as aliases of `--cobalt/--green/--red/--amber` (so untouched code doesn't break mid-migration). Remove `--shadow/--shadow-lg` + all `box-shadow` from `.card`. Component classes: `.btn` gains `:active` press state + `min-height:44px` touch target, remove `:hover`-only effects; `.input-field`, `.chip*`, `.exchange-btn`, `.stat` re-tokenized. Add `--safe-top`/`--safe-bottom`, `-webkit-tap-highlight-color: transparent`, `font-family` on base, mono on `.stat`-type numerics.
4. `frontend/src/App.tsx` — delete the theme effect (App.tsx:508–551): no `--tg-*` binding, no light/dark toggle, always dark.
5. `frontend/src/types/index.ts` — extend `TelegramWebApp` with `ready`, `setBackgroundColor`, `setHeaderColor`, `setParams`, `safeAreaInset`, `contentSafeAreaInset`.
6. `frontend/src/hooks/useTelegram.ts` — on init: `wa.ready()`, `wa.expand()` (already), `setBackgroundColor('#05070C')`, `setHeaderColor` blend, `MainButton.setParams({color:'#3D63FF', text_color:'#FFFFFF'})` (guarded, same for SecondaryButton if present), bind `safeAreaInset` + `contentSafeAreaInset` + their change events to `--safe-top/--safe-bottom` (exact snippet pattern from spec), `env(safe-area-inset-bottom)` fallback in CSS.

Deliverable: app is dark/cobalt with the right fonts, no shadows/gradients in the token layer, safe-area vars live. Screens still show old component styling where it was raw — that's expected and fixed per-phase below.

### Phase 1 — Navigation shell & shared primitives
Files (5):
1. `frontend/package.json` — add `lucide-react`
2. `frontend/src/components/icons.tsx` (new) — `<Icon>` wrapper (lucide, `strokeWidth={2}`, `size={20}`) + named exports used app-wide (Gauge, ArrowLeftRight, Wallet, User, Bell, Star, Search, TrendingUp, ChartLine, Clock, AlertTriangle, Trash2, X, Check, Lock, Download, Share2, Zap, ChevronDown, RefreshCw, Calculator, Flame, Trophy, Globe, Settings, Eye, EyeOff, ExternalLink, Plus, Minus, Filter/SlidersHorizontal, Sparkles, Play, Send, Copy, CheckCircle2, XCircle, History, Link2, QrCode, ShieldAlert, Info, Loader2…)
3. `frontend/src/components/Navigation.tsx` — re-skin: `--bg1` bg + `border-top 1px var(--border)`, `padding: 10px 16px calc(10px + var(--safe-bottom))`, active tab `--cobalt-text` (icon+label), inactive `--text3`, real icons, badge → `--red` bubble on `--red-soft`, `:active` press state, 44px tap target.
4. `frontend/src/components/Toast.tsx` — token surfaces (success → `--green-soft` bg + `--green` text; error → `--red-soft` + `--red`; spread → `--cobalt-soft` + `--cobalt-text`; info → `--bg1` + `--text2`), border 1px `--border`, no shadow, keep durations/animation.
5. `frontend/src/components/WebHeader.tsx` — logo → landing pattern (cobalt rounded square `ff` mark, mono), tokens, blur stays (spec-allowed header blur).

Self-check: every nav/toast color traces to a token; safe-bottom applied; no hover-only effects.

### Phase 2 — Scanner (MainPage) — the core screen, highest fidelity
Files (6):
1. `frontend/src/pages/MainPage.tsx` — header logo mark (landing `.logo/.mark`); **KPI strip** (`.kpi` × 4: exchanges tracked / pairs in live scan / fee to view / time to best route — real data per §2.3, `—` when absent); sticky scan card gains `padding-top: var(--safe-top)`; top-pick banner: gradient → flat `--cobalt-soft` bg + 1px `--cobalt` border; result rows restructured toward `.opp`: pair bold + route muted + mono annualized (`--green`) + risk pill (soft bg + semantic color); replace 🖼 ↔ ⭐ 🔔 📊 🔒 with lucide icons; yield chips → token segmented control; `ResultSkeleton` (via Skeleton); alert modal select → custom-styled; mono for all rate figures; haptic: `impactOccurred('light')` on row taps, `hapticSuccess()` on scan complete, `hapticError()` on failed submit; pull-to-refresh kept.
2. `frontend/src/utils/formatters.ts` — `getRiskColor`/`getFundingColor` return token-based classes (`--green/--amber/--red` + soft variants), remove gray fallbacks.
3. `frontend/src/components/ExchangeSelect.tsx` — dropdown: `--bg1` surface, 1px `--border-2` interactive border, no `shadow-lg`, ▴▾ → `ChevronDown` icon, checkmark → lucide, raw checkboxes custom-drawn.
4. `frontend/src/components/ExchangeSelector.tsx` — chip tokens, `chip-x` → `X` icon.
5. `frontend/src/components/FundingCalendar.tsx` — token borders, mono numbers, `text-green-700/red-700` → `--green/--red`.
6. `frontend/src/utils/shareCard.ts` — palette → tokens (`BRAND:#3D63FF`, `DARK:#05070C`, `GREEN:#34D399`, `MUTED:#8891A3`).

### Phase 3 — Arbitrage core (opportunities + alerts + filter)
Files (3):
1. `frontend/src/pages/ArbitragePage.tsx` — tabs → segmented `--cobalt` active; `OpportunityCard` → `.opp` pattern (risk pill tokens; persistence grades A→`--green`, B→`--cobalt-text`, C→`--amber`, D→`--amber`, F→`--red`); `border-l-4` accents → 1px `--border` cards; OI-signal colors → 3-semantic set; 💰📊🔕🔔🗑️⚠️💡▸▾ → lucide; alerts rows → token badges; ProfitCalculator modal → `.calc` treatment (mono numbers, illustrative note kept); skeleton → token classes.
2. `frontend/src/components/FilterBar.tsx` — 🔧 → `SlidersHorizontal`; segmented control tokens; `border-gray-300` → `--border`.
3. `frontend/src/components/MarketDataTable.tsx` — full token conversion (was bypassing everything): gray-700/800 palette → `--bg1/--card/--border`, blue tabs → `--cobalt`, green/red bars → `--green/--red` with alpha.

### Phase 4 — Arbitrage secondary tabs (spot-futures + heatmaps)
Files (3):
1. `frontend/src/components/SpotFuturesPanel.tsx` — raw palette (blue-50/purple-50/gray-*) → tokens; 💡 → lucide `Lightbulb`.
2. `frontend/src/components/Heatmap.tsx` — red-300/500 + green-300/500 scale → `--green/--red` with opacity steps (data visualization — token hues only, no fourth hue).
3. `frontend/src/components/LiquidationHeatmap.tsx` — `--green/--red` tokens, `blue-500` dot → `--cobalt`.

### Phase 5 — Portfolio + shared row/chrome components
Files (4):
1. `frontend/src/pages/PortfolioPage.tsx` — 📊🔗 tabs → lucide; live KPI boxes → `.kpi` pattern (label `--text3`, mono value); ⬇ → `Download`, ⚠️ → `AlertTriangle`, ⧉ → lucide; green/red-700 text → `--green/--red`; raw selects custom-styled; `text-gray-500` → `--text2`.
2. `frontend/src/components/CountdownTimer.tsx` — `bg-blue-500/amber-500` → `--cobalt` fill; mono digits.
3. `frontend/src/components/PullToRefresh.tsx` — custom box-shadow → flat token styling.
4. `frontend/src/components/ConfirmDialog.tsx` — `btn-danger` → `--red` tokens; flat.

### Phase 6 — Profile, plans, payments (includes the fabricated-number removal)
Files (6):
1. `frontend/src/pages/ProfilePage.tsx` — avatar gradient → flat `--cobalt`; plan banner gradient → flat `--cobalt` (or `--bg1` + `--cobalt` border); achievements: emoji icons → lucide (Trophy, Medal, Star, Bell, Users, Globe, ScanLine…), unlocked state `--amber-soft` + `--amber`; 📊🏅🎁🔗🤖📤✈💬📱 → lucide; `PlanCard` featured → 1px `--cobalt` border (no shadow), ✓ → `--green`; `text-gray-500` → `--text2`.
2. `frontend/src/components/PaywallModal.tsx` — **remove** fake `upgradeRate`, UrgencyTimer, exit-intent offer, trial 🔥 row keeps trial countdown (real data) with tokens + mono; billing toggle → segmented `--cobalt`; plan compare → `.plan`-style flat cards with `--cobalt` border on recommended; ✕ ★ ✓ → lucide; all rgba gradients → flat soft token bgs.
3. `frontend/src/components/TrialCTA.tsx` — remove gradient; urgency variants → `--red-soft/--amber-soft/--green-soft` flat; ⚠️🎁🧠📊⚡ → lucide; mono countdown.
4. `frontend/src/components/CryptoCheckoutModal.tsx` — 🔷🔶🟡💠⬡ currency chips → lucide (CircleDollarSign etc.) or clean letter chips; ✅❌ → CheckCircle2/XCircle; tokens; fallback hexes removed.
5. `frontend/src/components/QrLoginModal.tsx` — **fix undefined classes** (`.modal-overlay/.modal/.spinner`) → proper token styling; 📱✕✅ → lucide; QR colors → token palette.
6. `frontend/src/components/ContextMenu.tsx` — 🔔📈⭐☆🔗 → lucide; `--line` → `--border`; `#ef4444` → `--red`; `shadow-2xl` removed.

### Phase 7 — Onboarding & activation surfaces
Files (6):
1. `frontend/src/components/Onboarding.tsx` — wizard emoji (🚀👤🎯📊💎🌱📈💰🔄⚡🎁🎉✓) → lucide; tokens; `bg-green-400/gray-300` → tokens.
2. `frontend/src/components/ActivationChecklist.tsx` — 🔥 streak badge → lucide `Flame` on `--amber-soft`/`--amber` (kept per decision); 🎉💡📆✕✓→ → lucide; orphan `--green/--amber` now tokenized.
3. `frontend/src/components/QuickStart.tsx` — ✓✕ → lucide; tokens.
4. `frontend/src/components/InstallBanner.tsx` — ⚡ → `Zap`; tokens.
5. `frontend/src/components/SoftPaywallBanner.tsx` — gradient tint → flat `--bg1`/`--cobalt-soft`; 🔒 → `Lock`; ✕ → lucide; `--red` → tokens.
6. `frontend/src/components/RiskProfileModal.tsx` — `text-green-700` → tokens; presets → soft token bgs.

### Phase 8 — Settings & remaining screens
Files (6):
1. `frontend/src/pages/SettingsPage.tsx` — section emoji (🔔📱🏦🔍🌐🎨📦) → lucide; gray-600/700/500 labels → `--text2/--text3`; badge pills → soft tokens; **toggle switches custom-drawn** (spec: no raw browser controls); keep `.dark:`-variant lines? No — dark-only now, so the `dark:` classes become dead → replaced by token classes.
2. `frontend/src/components/LanguageSwitcher.tsx` — segmented pills: active `--cobalt` bg + white text, inactive `--text3`, 1px `--border-2`.
3. `frontend/src/pages/TermsPage.tsx` — `text-gray-700/500` → tokens.
4. `frontend/src/pages/PrivacyPage.tsx` — same.
5. `frontend/src/components/LoginPage.tsx` — `shadow-lg` removed; 💰🙈👁 → lucide; fallback hexes (`#e5e7eb`, `#f3f4f6`, `#3390ec`) → tokens.
6. `frontend/src/pages/PublicPage.tsx` — gradient hero → flat `--bg1` + `--border` + `--cobalt` accents (no glow — landing-only exception); gradient CTA → flat `--cobalt`; blue-50 tables → token softs; `text-blue-900` → `--text`; spinner → `--cobalt`.

### Phase 9 — Internal/dev surfaces
Files (3):
1. `frontend/src/pages/AdminPage.tsx` — stat-card raw palette → token-derived soft backgrounds (cobalt/green/amber/red softs only); text colors → `--text2/--text3`; tables → `--border`.
2. `frontend/src/components/DebugLog.tsx` — minimal token pass: `--bg1` panel, `--border` lines, level colors → `--green/--amber/--red/--cobalt-text`, mono kept.
3. `frontend/src/pages/QrScanPage.tsx` — full inline-hex → token palette (`#0f172a`→`--bg1`, `#3390ec`→`--cobalt`, `#94a3b8`→`--text2`, `#ef4444`→`--red`, `#fff`→`--text`), ✅❌ → lucide.

### Phase 10 — Copy pass (i18n dictionaries)
Files (6): `frontend/src/i18n/{en,ru,tr,vi,hi,es}.ts` — remove spec-banned clichés and urgency ("unlock", "Limited time", "Wait — special offer just for you!", "risk-free", "before anyone else", emoji baked into strings like `🔥 New spread` / `🔒 You've used…`); replace with plain numeric-register copy in all 6 languages. No new fabricated figures; the "SAVE10" code lines are removed with the exit-offer. Only key *values* change — no keys added/removed.

### Phase 11 — Full QA pass
- Walk every screen against the spec's self-check list:
  - every color traces to a token (grep for `#[0-9a-fA-F]` and raw `text-*/bg-*/border-*` Tailwind colors across `src/` — must be zero outside tokens/icons)
  - fixed/sticky elements use `--safe-top/--safe-bottom`; no `:hover`-only effects; all tap targets ≥44px
  - MainButton/SecondaryButton branded; canvas dark in all themes
  - no gradients (except none — app gets no hero glow), no shadows, no emoji-as-icon (grep re-run of the emoji scan — zero functional usages)
  - mono for numbers only; risk colors = 3 semantics; layout rhythm varies; copy numeric & plain
- Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test` (frontend).
- Report per-screen results; fix stragglers.

---

## STEP 4 — Working agreement

1. Work happens one phase at a time, in order. After each phase: build/lint/typecheck/tests pass, then self-check against the spec checklist, then **stop and report** — no phase starts until you approve.
2. Any deviation from the spec, or a needed value not in the token table, is read from the landing file first (spec's own rule) and surfaced in the phase report.
3. Tests that assert on old classes/colors are updated only where needed to keep `npm run test` green (existing tests: Navigation, Skeleton, ConfirmDialog, PaywallModal, PaywallPortfolio, Heatmap, formatters, plans).
