---
name: Clinical POS System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#44474f'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#747780'
  outline-variant: '#c4c6d0'
  surface-tint: '#455e8d'
  primary: '#00183b'
  on-primary: '#ffffff'
  primary-container: '#0f2d59'
  on-primary-container: '#7c95c8'
  inverse-primary: '#adc7fc'
  secondary: '#005cba'
  on-secondary: '#ffffff'
  secondary-container: '#5095fe'
  on-secondary-container: '#002d61'
  tertiary: '#001e12'
  on-tertiary: '#ffffff'
  tertiary-container: '#003523'
  on-tertiary-container: '#2ca879'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e2ff'
  primary-fixed-dim: '#adc7fc'
  on-primary-fixed: '#001b3f'
  on-primary-fixed-variant: '#2c4674'
  secondary-fixed: '#d7e3ff'
  secondary-fixed-dim: '#aac7ff'
  on-secondary-fixed: '#001b3e'
  on-secondary-fixed-variant: '#00458e'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
  data-display-lg:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  data-display-md:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  data-table:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-shortcut:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.25rem
  space-2xl: 1.5rem
  space-3xl: 2rem
  table-row-h: 2.25rem
  pos-sidebar-w: 340px
  container-pad: 1.5rem
---

## Brand & Style

This design system is engineered for high-throughput, mission-critical hospital pharmacy counter environments running across dedicated offline local area networks (LAN). The core audience comprises licensed clinical pharmacists, pharmacy technicians, and hospital billing officers operating desktop workstations under rapid queue conditions. The environment requires extreme visual stability, uncompromised precision, rapid barcode scan acknowledgment, and zero visual ambiguity.

The design movement is **Corporate Clinical Minimalist** combined with **Ergonomic Utilitarianism**:
- High-contrast, glare-resistant surfaces built for varied hospital monitor environments (including standard 1080p and 720p counter displays).
- Dense tabular information hierarchy prioritizing drug names, batch lot numbers, DRAP (Drug Regulatory Authority of Pakistan) registration numbers, pack units, and currency values.
- Keyboard-first operational paradigms with explicit, high-visibility F-key action tags (F1–F12, Esc, Enter) embedded directly into interactive elements to eliminate mouse dependency during active dispensing queues.
- Authoritative healthcare trust conveyed through deep medical navies, crisp informational blues, and decisive status greens denoting active offline-LAN database synchronicity.

## Colors

The palette establishes an immediate clinical hierarchy with high contrast ratios exceeding WCAG AAA standards on key transaction numbers.

### Core Roles
- **Primary (`#0f2d59`)**: Medical deep navy for primary structural bars, active focus states, top navigation anchors, high-level headers, and high-impact values.
- **Secondary (`#0066cc`)**: Clear trust blue for primary buttons, active search highlighting, primary tab selections, and currency symbol accents (`Rs`).
- **Tertiary / Success (`#059669`)**: Clinical emerald for successful LAN synchronization, live counter status indicators, change return calculations, and verified batch balances.
- **Neutral (`#64748b`)**: Slate neutral providing stable structure across hairline borders, table dividers, secondary labels, and neutral icon fills.

### Functional Alert Tokens
- **Amber Warning (`#d97706`)**: Till status warnings, near-expiry alerts (within 30–90 days), and missing DRAP or batch code indicators.
- **Red Critical (`#dc2626`)**: Critical expiry (off-the-shelf), zero-stock triggers, negative cash drawer state, and unauthorized schedule drug dispensing.
- **Surface Canvas (`#f8fafc`)**: Soft clinical off-white canvas reducing retinal fatigue under fluorescent hospital lighting.
- **Surface Card / Table (`#ffffff`)**: Pure white structured container surfaces for transactional clarity and crisp border containment.
- **Hairline Border (`#e2e8f0`)**: Low-contrast architectural separators ensuring dense layouts remain structured without visual clutter.

## Typography

The typographic hierarchy separates narrative human-readable text from precision clinical transaction values:
- **Headlines (`Manrope`)**: Provides modern clinical authority, balanced geometric forms, and high legibility on dashboard metrics and structural screen titles.
- **Body (`Inter`)**: Applied to UI instructions, generic medicine formulas, manufacturer disclosures, and patient demographic forms.
- **Data & Numeric Display (`JetBrains Mono`)**: Applied across all numeric financial calculations (`Rs`), inventory batch codes, expiry dates, quantities, barcode numbers, and keyboard shortcut badges. Monospace tabular alignment ensures decimal figures and vertical columns never jitter during rapid quantity edits.

## Layout & Spacing

The workstation layout follows a fixed, non-scrolling split architecture calibrated for 16:9 and 16:10 desktop monitors (1280px minimum horizontal resolution, optimized for 1920×1080):
- **Header Bar**: Fixed 52px height across the top housing branding, persistent LAN connectivity pills, offline queue sync stats, workstation identity, and till session indicators.
- **POS Dual-Pane Model**:
  - **Left Pane (Fluid / Flexible)**: Dedicated to rapid drug lookup (barcode/name/generic search), active bill line items, and batch selection. Uses a strict 12px vertical spacing rhythm to fit 12–15 cart items without vertical page scrolling.
  - **Right Pane (Fixed 340px - 380px)**: Dedicated to the financial engine: Net Payable calculation card, discount overrides, tender input, quick denomination buttons (`Rs 50`, `100`, `500`, `1000`), change calculation, and execution hotkey (`Complete Sale [F9]`).
- **Dashboard Grid**: A balanced 12-column grid with 16px gutters and 16px container margins for analytics, inventory alerts, expiry trackers, and recent bill registers.

## Elevation & Depth

This system avoids floating glass effects and heavy decorative drop shadows. Depth is communicated strictly through surface layering and hairline borders:
- **Base Canvas**: Surface Canvas (`#f8fafc`).
- **Card Containers**: Solid white (`#ffffff`) bounded by a clean 1px solid border (`#e2e8f0`). No drop shadow in default resting states.
- **Elevated Interactive Layer**: When a modal opens (e.g., Batch Selector or Day-End Till Close), use a restrained architectural shadow: `0 4px 12px -2px rgba(15, 45, 89, 0.08), 0 2px 4px -1px rgba(15, 45, 89, 0.04)` over a 40% `#0f2d59` backdrop blur overlay.
- **Focus & Barcode Active States**: Input fields and selected table rows employ a high-visibility 2px solid primary ring (`#0066cc`) with zero shadow blur, ensuring instantaneous keyboard feedback.

## Shapes

The geometric personality is **Soft / Precision Compact** (`roundedness: 1`):
- Default inputs, buttons, and summary cards use `0.25rem` (4px) corner radiuses.
- Badges, status chips, and hotkey tag blocks use `0.25rem` (4px) or minimal `2px` micro-radiuses to preserve density.
- Large metric display blocks and primary surface cards use `0.375rem` (6px) up to `0.5rem` (8px). Rounded pill shapes (`rounded-full`) are strictly restricted to live online/offline state indicators and avatar circles.

## Components

### Barcode & Global Drug Search Input
- **Container**: Full-width prominent single-line input with an integrated barcode glyph. Height: 44px. Background: `#ffffff`, border: 1.5px solid `#cbd5e1`.
- **Keyboard Shortcut Integration**: Display `[F2] Search` right-aligned within the input frame.
- **Active State**: Border color flips to `#0066cc` with a sharp 1px `#0066cc` outline. Instant autofocus on POS initialization and after every committed transaction.

### Action Buttons & Hotkey Badges
- **Primary Button (`Complete Sale`)**: Height 44px. Background: `#2563eb` (hover: `#1d4ed8`). Font: Inter Bold 14px, white text. Embeds an inline shortcut chip on the right edge: background `#1e40af`, text `#ffffff`, font `JetBrains Mono` 10px bold.
- **Tender Denomination Buttons**: Compact grid of quick cash chips (`Exact`, `50`, `100`, `500`). Height 32px, background `#f1f5f9`, border 1px solid `#cbd5e1`, text `#0f2d59` font `JetBrains Mono` 12px semi-bold.
- **Action Footers**: Secondary function triggers (`Day-End Close`, `Department Slips`, `Credit Accounts`) use clean white button states with subtle slate borders and grey icons.

### Transaction Line Item Tables
- **Header**: Height 28px. Background `#f8fafc`, text color `#64748b`, typography `label-caps` (10px uppercase, tracking 0.06em).
- **Rows**: Alternating white and `#fbfcfd` backgrounds, height 36px. Border-bottom 1px solid `#e2e8f0`.
- **Columns**: Monospaced tabular alignment for Quantity, Batch, Unit Price, and Line Total. Interactive row highlight uses `#eff6ff` (soft blue tint).

### Financial Summary Cards
- **Net Payable Container**: Elevated white card framed with `#e2e8f0`. Value rendered in `data-display-lg` (`#0066cc`). Currency sign `Rs` styled in 18px medium weight.
- **Change Due Box**: Full-width highlight box. When change is due (> 0), background switches to mint tint (`#ecfdf5`), border to `#a7f3d0`, and text value to `#059669` in bold tabular monospace.

### Status Indicators & Pills
- **LAN / Counter Connected**: Pill container with background `#ecfdf5`, border 1px solid `#a7f3d0`, text `#065f46`, featuring a glowing square/circle emerald dot (`#10b981`).
- **Till State**: Warning pill with background `#fef3c7`, border `#fde68a`, text `#92400e`.
- **Expiry Badges**: Compact tags (`Expired`, `10d left`, `21d left`). Expired items show red tag (`#fee2e2`, text `#991b1b`). Near-expiry items show amber tag (`#fef3c7`, text `#b45309`).