# HWT Pharmacy admin: mobile fix spec

**App:** hwt-pharmacy.onrender.com (build v0.1.0), logged in as System Administrator
**Checked:** 16 Sep 2026
**Widths:** 360, 390, 414 (phones) · 768, 820 (tablet portrait) · 1024 (tablet landscape) · 1150 to 1920 (POS cart only)
**Scope:** all 23 sidebar pages, 5 report views, the New medicine master modal

How it was tested: each route was loaded in a same-origin frame at exact CSS widths. I measured the DOM for sideways scroll, clipped content, tap target sizes, input font sizes and table widths, then checked every problem by eye. I didn't have the source, so class names below are copied from the rendered HTML. Grep for them.

Not covered: real iPhone/Android hardware, the login page, donor/patient portals. The iOS zoom and 100vh items are read from the CSS, not seen on a device. Nothing was saved or submitted.

---

## Summary

- **Phones can't use the admin today.** The sidebar is a fixed 256px column at every width. Content gets 104px at 360 and 134px at 390. Text breaks one word, sometimes one letter, per line.
- **The header has no small-screen layout.** At 768 the page title gets 22px. On phones it gets 0px. It wraps word by word and paints over the page intro.
- **Fix the shell (items 1, 2, 11, 12) and 19 of 23 pages stop scrolling sideways at 360px.**
- Four pages still overflow after that: Pharmacy Counter, Day Close, Inventory, Vendors. Inventory and Vendors already overflow on a 768 tablet.
- **POS cart bug, not just mobile:** the Medicine name column is 0px whenever the cart is under 720px wide. That covers 1024 (0px), 1280 (7px) and 1366 (72px) screens.
- **Side bug, every device:** leaving Roles & Permissions white-screens the app.

| Priority | # | Issue | Pages |
|---|---|---|---|
| P0 | 1 | Sidebar never collapses | All |
| P0 | 2 | Header title spills over content | All |
| P0 | 3 | POS cart hides medicine names | Pharmacy Counter |
| P0 | 4 | Leaving Roles crashes the app | Roles & Permissions |
| P1 | 5 | Page action bars don't wrap | Day Close, Inventory, Vendors |
| P1 | 6 | Scanner box forces 384px | Pharmacy Counter |
| P1 | 7 | Billing mode buttons clipped | Pharmacy Counter |
| P1 | 8 | Sticky scanner card is 210px tall | Pharmacy Counter |
| P1 | 9 | Modal header buttons cut off | New medicine master (likely all header-action modals) |
| P1 | 10 | KPI tiles break | Dashboard, Cash Flow, Inventory, Vendors |
| P1 | 11 | Footer status bar eats height | All |
| P1 | 12 | 100vh on mobile browsers | All |
| P2 | 13 | Tap targets 20-30px | Most |
| P2 | 14 | Inputs trigger iOS zoom | Most |
| P2 | 15 | Wide tables, actions off-screen | 13 pages |
| P2 | 16 | Keyboard hints shown on touch | All |
| P2 | 17 | Roles editor far below the list | Roles & Permissions |
| P2 | 18 | Smaller layout nits | Catalogue, Reports, POS, Dashboard |

---

## P0

### 1. Sidebar never collapses

**Where:** app shell, `aside.w-64 ... shrink-0 ... no-print`. It sits beside the content at every width and there's no toggle.

| Viewport | Sidebar | Content column |
|---|---|---|
| 360 | 256 | 104 |
| 390 | 256 | 134 |
| 414 | 256 | 158 |
| 768 | 256 | 512 |
| 1024 | 256 | 768 |

At 1024 no page scrolls sideways and titles fit, so keep the sidebar static from `lg` up. Below that, make it an off-canvas drawer.

**Fix** (the layout component that renders aside / header / main / footer):

```jsx
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

export default function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  // close the drawer after every navigation
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Esc closes it, and the page behind can't scroll while it's open
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  return (
    <div className="app-shell h-screen flex overflow-hidden text-slate-800 bg-[#f8f9ff] antialiased font-sans">
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden no-print"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={[
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200',
          navOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:transition-none',
          'bg-[#0b1f3d] flex flex-col justify-between shrink-0 select-none border-r border-[#15345f] no-print',
        ].join(' ')}
      >
        {/* existing sidebar content, plus a close button in the logo row: */}
        {/* <button className="lg:hidden h-11 w-11 ..." onClick={() => setNavOpen(false)} aria-label="Close menu">×</button> */}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* pass title and dateLabel the way the current header gets them */}
        <Header onMenu={() => setNavOpen(true)} menuOpen={navOpen} />
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="min-h-full flex flex-col gap-4 p-3 sm:p-4 lg:gap-6 lg:p-6 ws-content admin-content">
            <Outlet />
          </div>
        </main>
        <StatusFooter />
      </div>
    </div>
  );
}
```

Also in the sidebar: nav rows are 28px tall (`py-1`). Use `py-2.5 lg:py-1` so drawer rows are about 44px. Same for the Admin group toggle (26px) and Sign Out (28px). On phones, move the theme toggle into the drawer footer (see item 2).

### 2. Header title spills over the page

**Where:** `header.h-16 ... px-6 flex items-center justify-between`. The right cluster (Counter Connected, date, theme, F5, Export) is about 440px and never shrinks. The title block has `min-w-0`, so it gets the leftovers.

Measured:
- 390, even with the sidebar gone: `h1` is 0px wide. On Inventory it's 0 × 125px, so the words stack and draw over the intro text.
- 768 today: 22px wide (Vendors 22 × 100, Catalogue 22 × 150).
- 1024: 158 to 278px, two lines, fits.
- Export wraps to two lines (82 × 44). Theme and F5 are 28 to 30px tall.

**Fix:**

```jsx
function Header({ title, dateLabel, onMenu, menuOpen }) {
  return (
    <header className="min-h-[3.5rem] lg:h-16 bg-white border-b border-slate-200 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 shrink-0 shadow-sm no-print">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onMenu}
          className="lg:hidden -ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          aria-label="Open menu"
          aria-controls="app-sidebar"
          aria-expanded={menuOpen}
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <h1 className="truncate lg:whitespace-normal lg:overflow-visible text-base sm:text-lg lg:text-xl font-extrabold text-[#0b1f3d] tracking-tight font-headline m-0 leading-tight">
          {title}
        </h1>

        {/* "Clinical POS Core" chip */}
        <span className="hidden lg:inline-flex ...">Clinical POS Core</span>
      </div>

      <div className="flex items-center gap-1.5 lg:gap-4 shrink-0">
        {/* connection chip: dot only on phones */}
        <div className="inline-flex items-center px-2 lg:px-3 ...">
          <span className="w-2 h-2 rounded-full bg-emerald-500 ..." />
          <span className="hidden md:inline ml-2">Counter Connected</span>
        </div>

        <div className="hidden md:flex ...">{dateLabel}</div>

        {/* theme: move into the drawer on phones */}
        <button className="hidden sm:inline-flex h-11 w-11 lg:h-auto lg:w-auto ...">☾</button>

        <button className="inline-flex h-11 w-11 lg:h-auto lg:w-auto items-center justify-center ...">
          <RefreshIcon />
          <span className="hidden lg:inline ml-1">F5</span>
        </button>

        <button className="inline-flex h-11 px-3 lg:h-auto items-center gap-1 whitespace-nowrap ...">
          <DownloadIcon className="sm:hidden" />
          <span className="hidden sm:inline">Export</span>
          <span className="hidden lg:inline">[Alt+E]</span>
        </button>
      </div>
    </header>
  );
}
```

That leaves the title about 185px at 390. If that's too short for names like "Inventory, Batches & DRAP Compliance", add a `shortTitle` per route for phones.

### 3. POS cart hides the medicine name

**Where:** cart table `table.w-full.table-fixed.text-left.text-xs.border-collapse` on Pharmacy Counter. Seven columns have fixed widths that add up to 720px. Medicine has no width, so under `table-fixed` it only gets what's left after 720px.

Medicine column width as shipped (sidebar visible):

| Viewport | Cart width | Medicine column |
|---|---|---|
| 390 (sidebar hidden) | 341 | **0** |
| 768 | 462 | **0** |
| 1024 | 718 | **0** |
| 1150 | 845 | 125 |
| 1280 | 727 | **7** |
| 1366 | 792 | **72** |
| 1440 | 847 | 127 |
| 1536 | 919 | 199 |

1280 is worse than 1150 because `.ph-cols` switches the POS to two columns above 1180px.

**Fix, tablet and up:** shrink the fixed columns and put a floor on the table, so the wrapper scrolls instead of eating the name.

| Column | Now (px) | Suggested (px) |
|---|---|---|
| # | 32 | 32 |
| Medicine | leftover | leftover |
| Expiry | 96 | 80 |
| On shelf | 80 | 64 |
| Dispense qty | 256 | 176 (check the stepper still fits) |
| Rate | 128 | 96 |
| Line total | 96 | 96 |
| Remove | 32 | 32 |
| `<table>` | `w-full table-fixed` | `w-full table-fixed min-w-[44rem]` |

New fixed total is 576px. Medicine then gets 142px at 1024, 151px at 1280, 216px at 1366, and never drops under 128px.

**Fix, phones:** show cart lines as cards under `md`, keep the table from `md` up.

```jsx
{/* phones */}
<ul className="md:hidden divide-y divide-slate-200">
  {lines.map((l) => (
    <li key={l.id} className="py-3 flex gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{l.name}</p>
        <p className="text-xs text-slate-500">Exp {l.expiry} · {l.onShelf} on shelf · {l.rate}</p>
        <QtyStepper line={l} className="mt-2" />
      </div>
      <div className="shrink-0 text-right">
        <p className="font-bold tabular-nums">{l.lineTotal}</p>
        <button className="mt-2 h-11 w-11 ..." aria-label="Remove line">×</button>
      </div>
    </li>
  ))}
</ul>

{/* tablet and up: the existing table */}
<table className="hidden md:table w-full table-fixed min-w-[44rem] text-left text-xs border-collapse">…</table>
```

### 4. Leaving Roles & Permissions blanks the app

**Repro:** open Admin > Roles & Permissions, then click any other sidebar link (tried Employees, Dashboard, Sync). The screen goes white. Console: `TypeError: n is not a function` from React's effect cleanup. Users > Employees > Settings works, so it's this page.

**Cause** (from the built bundle): the page hands its loader straight to `useEffect`. The loader is an expression-bodied arrow, so it returns the `api.get('/users/roles…')` promise. React treats whatever an effect returns as its cleanup and calls it on unmount. A promise isn't callable, and with no error boundary the whole tree unmounts.

```js
// now (roughly)
const loadRoles = useCallback(() => api.get('/users/roles').then(/* ... */), []);
useEffect(loadRoles, [loadRoles]);

// fix
useEffect(() => { loadRoles(); }, [loadRoles]);
```

To find it, grep the Roles page for `useEffect(` near the "A role is a named set of permissions" copy. The bundle has 22 more `useEffect(fn, [fn])` calls. Their callbacks have block bodies, so they're safe today. Wrap them the same way anyway so a refactor can't bring this back.

Add a route-level error boundary too, so one broken page can't white-screen the counter:

```jsx
import { Component } from 'react';

export class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <p className="font-semibold">This page hit an error.</p>
        <button className="ws-btn mt-3" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

// in AppShell: <RouteErrorBoundary resetKey={pathname}><Outlet /></RouteErrorBoundary>
```

---

## P1

### 5. Page action bars don't wrap

**Where:** the actions row in the page header, `div.flex.items-center.gap-1.5` (Refresh plus the page buttons). `.ws-btn` has `white-space: nowrap`, so the row can't shrink.

| Page | Row width | Sideways scroll at 390 | At 768 today |
|---|---|---|---|
| Day Close | 421px | 55px | fits |
| Inventory | 501px | 135px | 13px |
| Vendors | 552px | 186px | 64px |

**Fix** (probably one shared page-header component):

```diff
- <div className="flex items-center gap-1.5">
+ <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
```

If the title block and this row share one `justify-between` row, stack that row on phones:

```diff
- flex items-start justify-between
+ flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between
```

Optional: on phones keep one primary button and tuck the rest (Demand slip, Record order, Print) into a "More" menu.

### 6. POS scanner box forces 384px

**Where:** `div.relative.flex-1.min-w-[24rem].basis-[28rem]` around the barcode input. The page scrolls sideways 31px at 390 and 61px at 360.

```diff
- relative flex-1 min-w-[24rem] basis-[28rem]
+ relative flex-1 min-w-0 basis-full sm:min-w-[24rem] sm:basis-[28rem]
```

### 7. Billing mode buttons are clipped

**Where:** the BILLING MODE row, `div.flex.items-center.gap-1.5`, inside a card that hides overflow. It runs 21px past the card at 390 and 51px at 360. "3. Department requisition" gets cut and the other labels wrap to three lines.

```jsx
<div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
  <button className="min-h-[44px] sm:min-h-0 ...">
    <span className="sm:hidden">Customer</span>
    <span className="hidden sm:inline">1. Customer / Welfare card</span>
  </button>
  <button className="min-h-[44px] sm:min-h-0 ...">
    <span className="sm:hidden">Walk-in</span>
    <span className="hidden sm:inline">2. Walk-in</span>
  </button>
  <button className="min-h-[44px] sm:min-h-0 ...">
    <span className="sm:hidden">Dept.</span>
    <span className="hidden sm:inline">3. Department requisition</span>
  </button>
</div>
```

### 8. Sticky scanner card takes 40% of the screen

**Where:** `div.bg-white.rounded-md.border.border-slate-300.p-3.shadow-xs.shrink-0.sticky.top-0.z-20` (scanner plus the F2/F3/F4/F6/F5/F9/Esc tiles). At 390 it's 210px tall inside a 522px scroll area, and it stays pinned while the cart slides under it.

```diff
- shrink-0 sticky top-0 z-20
+ shrink-0 lg:sticky lg:top-0 z-20
```

On phones, make the F-key tiles a 3 or 4 column icon grid, and give Pay a fixed bottom bar:

```jsx
<div className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-slate-200 p-3">
  <button className="w-full h-12 rounded-md font-bold ...">Pay {netPayable}</button>
</div>
```

Add `pb-24 md:pb-0` to the POS page wrapper so the bar never covers the last row.

### 9. Modal header buttons get cut off

**Where:** New medicine master (Inventory). The header is `div.px-4.py-2.5.border-b ... flex items-center justify-between gap-3`, with the title left and Cancel/Save right. At 390 its content is 419px inside a 350px panel. "Save medicine master F9" ends 69px past the panel edge, so the main action is half hidden. `.modal-backdrop` also keeps 20px padding, and the panel caps at 90vh over a 1,100px form.

```diff
- px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3
+ px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3
```

Better on phones: move Cancel/Save into a footer inside the modal (`sticky bottom-0 bg-white border-t p-3 flex gap-2`) so Save stays reachable while scrolling. The bottom-sheet CSS is in the global patch. Form rows like Strength / Dosage form can go `grid-cols-1 sm:grid-cols-2`.

### 10. KPI tiles break on phones

Measured at 390:
- **Cash Flow:** the OPEN badge sits beside the value (`.ws-tile` is `flex justify-between`), which leaves the value 71px. With `break-words` it splits mid-word: "Cou / nter / 1" and "Rs 3,500.0 / 0".
- **Inventory:** "Rs 153,280.00" at 28px runs 9px past its tile.
- **Inventory, Vendors:** labels get truncated ("TOTAL PAYABLES T…", "ORDERS BOOKED (IN…").
- **Dashboard:** tiles use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, so below 640px the eight tiles stack into a 1,211px column before any real content.
- **Dashboard hub:** labels get cut ("Pharmacy C…", "Day-End Clo…").

Fix:
- Put badges and icons in the label row, not beside the value, so the value gets the whole tile width.
- Smaller value font on phones, and break only at spaces (global patch: `--tile-fs`, `overflow-wrap: normal`).
- Tile labels: `line-clamp-2` instead of `truncate` (built into Tailwind 3.3+).
- Dashboard tile grid: `grid-cols-1 sm:grid-cols-2` becomes `grid-cols-2`, with `p-3 sm:p-5` on the tiles.
- Hub tiles: `line-clamp-2` on labels, and hide the F-key chips on touch (item 16).

### 11. Footer status bar eats height

**Where:** `footer.bg-white.border-t.py-2.5.px-6.text-[11px] ... flex flex-wrap`. It's 131px tall at 390 today and 80px once the sidebar is gone. Add the 64px header and 22% of a phone screen is chrome.

Hide it on phones. The header dot already shows connection state, and the LAN / Node OK line lives in the sidebar.

```diff
- bg-white border-t border-slate-200 py-2.5 px-6 text-[11px] text-slate-500 flex flex-wrap ...
+ bg-white border-t border-slate-200 py-2.5 px-6 text-[11px] text-slate-500 hidden md:flex flex-wrap ...
```

### 12. 100vh on mobile browsers

**Where:** the shell's `h-screen`, a `max-h-[calc(100vh-7rem)]` class, `.modal { max-height: 90vh }`, and a `min-height: 100vh` rule.

On iOS Safari and Android Chrome, 100vh is measured with the toolbar hidden. The bottom of the shell (and a POS pay bar) ends up under the browser toolbar. Use `dvh` with a `vh` fallback (global patch), and change the arbitrary class to `max-h-[calc(100dvh-7rem)]`.

---

## P2

### 13. Tap targets are 20-30px

Buttons under 32px tall at 390:

| Where | Count | Examples |
|---|---|---|
| Catalogue | 41 | Edit, Deactivate (28px) |
| Inventory | 26 | filter chips (28px), SHOW (20px) |
| Pharmacy Counter | 16 | billing mode (28px), tender buttons (30px), Exact (26px) |
| Audit Log | 16 | Inspect (28px) |
| Dialysis Form | 16 | Map (28px) |
| Customers & Cards | 7 | tabs (28px) |
| Cash Flow | 6 | 100 / 500 / 1000 / 5000 / Clear (24px) |
| Users | 6 | Deactivate (28px) |
| Vendors | 4 | New, filter tabs (28px) |
| Sidebar | all | nav rows (28px), Admin toggle (26px), Sign Out (28px) |
| Header | 2 | theme (28 × 30), F5 (53 × 30) |

Role permission checkboxes are 16px, but each sits inside a full-row label (299 × 116), so those are fine.

Fix: raise `--ctl-h` on touch widths (global patch) for `.ws-btn` and `.ws-ctl`. Buttons sized with Tailwind (`py-1`, `h-7`) need `min-h-[44px] lg:min-h-0`. Start with the cash note buttons. They get hit fast during till counts, so make them `h-12 min-w-[4rem]` on touch.

### 14. Inputs trigger iOS zoom

The inputs I checked render at 14px (`text-sm`), and `.ws-ctl` defaults to 12px. iOS Safari zooms in on focus for anything under 16px and leaves the page zoomed.

Inputs under 16px at 390: Settings 13, New medicine modal 12, Catalogue 6, Pharmacy Counter 5, Reports 4, Cash Flow 3, Dialysis Form 3, Inventory 2, most other pages 1 (the search box).

Fix: 16px on phones (global patch). Confirm on a real iPhone.

### 15. Wide tables

The good news: every table already sits in an `overflow-x-auto` wrapper, so none break the page. The catch is how far they scroll, and row actions (Edit, Deactivate, Inspect) sit off-screen on the right. On Audit Log you see 2 of 7 columns.

Table widths at 390 (visible area about 341px):

| Page | Cols | Width |
|---|---|---|
| Audit Log | 7 | 1,243 |
| Reports (default view) | 10 | 906 |
| Report: Cash flow | 9 | 859 |
| Cash Flow | 9 | 830 |
| Employees | 9 | 823 |
| Inventory | 6 | 796 |
| Catalogue (dosage forms) | 6 | 762 |
| Pharmacy Counter cart | 8 | 720 (see item 3) |
| Users | 6 | 708 |
| Stock Audit | 6 | 644 |
| Report: Receivables | 9 | 615 |
| Subsidy Report | 6 | 505 and 586 |
| Departments | 8 | 553 |
| Report: Stock movements | 6 | 532 |
| Report: Credit daybook | 6 | 504 |
| Dialysis | 7 | 488 |
| Dashboard register | 6 | 454 (in a 301px card) |
| Report: Stock valuation | 4 | 405 |

Fix:
- **Admin lists with row actions** (Audit Log, Users, Employees, Catalogue, Inventory, Cash Flow, Departments, Subsidy, Stock Audit): stack rows into cards under 768px. Add `table-stack` to the `<table>` and a `data-label` to each cell (CSS in the global patch).

  ```jsx
  <table className="table-stack w-full ...">
    ...
    <td data-label="Staff">{row.user}</td>
    <td data-label="Action">{row.action}</td>
    <td data-label="">{/* buttons: empty label hides the caption */}</td>
  ```

- **Reports** are read-only and compared across columns, so keep them as tables and pin the first column with `table-pin-first`.

### 16. Keyboard hints on touch

F1/F2/F5/F8/F9/F10, Alt+E, Alt+N and Esc chips show on nav items, the header, POS tiles, hub tiles and modal buttons. On a phone they only take width. Add `kbd-hint` to the shared shortcut chip and the patch hides it on touch-only devices. An iPad with a keyboard but no trackpad will hide them too. Switch to a user setting if that matters.

### 17. Roles editor sits far below the list

On phones the role list stacks above the editor, so the editor starts under all six role cards and the page is 3,784px tall. If picking a role doesn't already scroll to the editor, add:

```jsx
const editorRef = useRef(null);

useEffect(() => {
  if (selectedRoleId && window.matchMedia('(max-width: 1023px)').matches) {
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}, [selectedRoleId]);

// <section ref={editorRef}> ...editor... </section>
```

### 18. Smaller stuff

- **Catalogue:** the info banner keeps the "17 dosage forms active" badge beside the text, so the text column is about 100px wide. Use `flex-col sm:flex-row`.
- **Reports filter:** at 390 the Group by select clips "Day (daily batch)". Two columns work, but `grid-cols-1 min-[420px]:grid-cols-2` reads better.
- **Pharmacy Counter at 768 today:** the customer row is `grid grid-cols-1 md:grid-cols-12`, sitting in a 438px card. Name and Phone inputs end up 46px wide with overlapping labels. The drawer fix gives it the full width. If you keep the sidebar on tablets, switch that row to `lg:grid-cols-12`.
- **Dashboard register:** the table sits in a `p-5` card inside the `p-6` page, leaving 301px. Add `-mx-5 sm:mx-0` to its wrapper on phones.

---

## Global CSS patch

Put this at the very end of the main CSS file, after `@tailwind utilities`, so it wins specificity ties. Then add the four classes listed below.

```css
/* ===== Mobile / touch patch ===== */

/* 12. dynamic viewport height */
@supports (height: 100dvh) {
  .app-shell { height: 100dvh; }
  .modal { max-height: 90dvh; }
}

/* 13 + 14. bigger controls, no iOS focus zoom */
@media (max-width: 1023px) {
  .ws-content,
  .admin-content {
    --ctl-h: 2.75rem; /* 44px */
    --btn-fs: 13px;
  }
}

@media (max-width: 767px) {
  .ws-content,
  .admin-content { --ctl-fs: 16px; }

  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
  select,
  textarea { font-size: 16px !important; }
}

/* 10. tiles */
@media (max-width: 639px) {
  .admin-content {
    --tile-pad: 12px 14px;
    --tile-fs: clamp(18px, 5.5vw, 24px);
  }

  .ws-tile-value {
    overflow-wrap: normal;
    font-variant-numeric: tabular-nums;
  }
}

/* 9. modals become bottom sheets */
@media (max-width: 639px) {
  .modal-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .modal {
    width: 100%;
    max-width: 100%;
    max-height: 92vh;
    max-height: 92dvh;
    border-radius: 16px 16px 0 0;
  }
}

/* 16. hide shortcut hints on touch-only devices */
@media (hover: none) and (pointer: coarse) {
  .kbd-hint { display: none !important; }
}

/* 15. tables that turn into cards */
@media (max-width: 767px) {
  .table-stack {
    min-width: 0 !important;
    table-layout: auto !important;
  }

  .table-stack thead { display: none; }

  .table-stack,
  .table-stack tbody,
  .table-stack tfoot,
  .table-stack tr,
  .table-stack td {
    display: block;
    width: 100% !important;
  }

  .table-stack tr {
    background: #fff;
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 8px;
  }

  .table-stack td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border: 0;
    text-align: right;
    white-space: normal;
  }

  .table-stack td::before {
    content: attr(data-label);
    font-weight: 600;
    color: #64748b;
    text-align: left;
  }

  .table-stack td[data-label=""]::before { content: none; }
}

/* 15. pinned first column for report tables */
.table-pin-first th:first-child,
.table-pin-first td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fff;
  box-shadow: 1px 0 0 var(--line, #e2e8f0);
}

.table-pin-first thead th:first-child {
  z-index: 2;
  background: #f8fafc;
}
```

Classes to add:

| Class | Goes on |
|---|---|
| `app-shell` | root shell div (`h-screen flex overflow-hidden ...`) |
| `kbd-hint` | the shared shortcut chip (F1, F5, Alt+E, Esc ...) |
| `table-stack` + `data-label` | Audit Log, Users, Employees, Catalogue, Inventory, Cash Flow, Departments, Subsidy, Stock Audit |
| `table-pin-first` | report tables |

---

## Page status

Items 1, 2, 11 and 12 apply to every page. Items 14 and 16 apply to almost all of them. The "Phone" column is what's left once the sidebar is out of the way.

| Page | Route | Phone (360 / 390) | Tablet 768 today | Items |
|---|---|---|---|---|
| Dashboard | `/` | Fits. Tiles stack 1,211px deep, hub labels cut | Header only | 10, 15, 18 |
| Pharmacy Counter | `/pharmacy` | Scrolls sideways 31-61px. Billing mode clipped, 210px sticky card, no medicine names | No medicine names, 46px name/phone inputs | 3, 6, 7, 8, 13, 18 |
| Day Close | `/pharmacy-close` | Scrolls sideways 55px | Header only | 5 |
| Returns | `/returns` | Fits | Header only | none |
| Inventory | `/inventory` | Scrolls sideways 135px. Tile value overflows, 796px table | Scrolls sideways 13px | 5, 9, 10, 13, 15 |
| Stock Audit | `/stock-audit` | Fits, 644px table | Header only | 15 |
| Vendors | `/vendors` | Scrolls sideways 186px. Tile labels cut | Scrolls sideways 64px | 5, 10, 13 |
| Catalogue | `/admin/catalogue` | Fits. Row actions off-screen, 41 small buttons | Header only | 13, 15, 18 |
| Customers & Cards | `/customers` | Fits. 28px tabs | Header only | 13 |
| Credit Accounts | `/credit` | Fits | Header only | none |
| Dialysis | `/dialysis` | Fits, 488px table | Header only | 15 |
| Cash Flow | `/cashflow` | Fits. Tile values split mid-word, 24px note buttons, 830px table | Header only | 10, 13, 15 |
| Departments | `/departments` | Fits, 553px table | Header only | 15 |
| Reports | `/reports`, `/reports/:key` | Fits. Tables 405-906px | Header only | 15, 18 |
| Subsidy Report | `/admin/subsidy` | Fits, 505 and 586px tables | Header only | 15 |
| Audit Log | `/admin/audit` | Fits. 1,243px table, 2 of 7 columns visible | Header only | 13, 15 |
| Users | `/admin/users` | Fits. 708px table, 28px Deactivate | Header only | 13, 15 |
| Roles & Permissions | `/admin/roles` | Fits. Editor far below the list | Header only | 4, 17 |
| Employees | `/admin/employees` | Fits, 823px table | Header only | 15 |
| Settings | `/admin/settings` | Fits. 13 inputs at 14px | Header only | 14 |
| Sync | `/admin/sync` | Fits | Header only | none |
| Corrections | `/amend` | Fits | Header only | none |
| Dialysis Form | `/admin/dialysis` | Fits. 16 Map buttons at 28px | Header only | 13 |

"Header only" means items 1 and 2 (sidebar takes a third of the width, title squeezed to 22px).

---

## Retest

**Quick check.** Chrome DevTools device toolbar at 360px, paste on each route. `sidewaysScroll` should be 0.

```js
(() => {
  const m = document.querySelector('main');
  const edge = m.getBoundingClientRect().right;
  const offenders = [...m.querySelectorAll('*')]
    .filter((el) => el.getBoundingClientRect().right > edge + 1 && !el.closest('.overflow-x-auto'))
    .slice(0, 5);
  return { sidewaysScroll: m.scrollWidth - m.clientWidth, offenders };
})();
```

**Guard in CI.** Set `baseURL` in `playwright.config` (e.g. `http://localhost:4000`), then save a logged-in session once:
`npx playwright codegen http://localhost:4000 --save-storage=e2e/auth.json`

```ts
// e2e/mobile-layout.spec.ts
import { test, expect } from '@playwright/test';

const routes = [
  '/', '/pharmacy', '/pharmacy-close', '/returns', '/inventory', '/stock-audit', '/vendors',
  '/admin/catalogue', '/customers', '/credit', '/dialysis', '/cashflow', '/departments',
  '/reports', '/admin/subsidy', '/admin/audit', '/admin/users', '/admin/roles',
  '/admin/employees', '/admin/settings', '/admin/sync', '/amend', '/admin/dialysis',
];

test.use({ storageState: 'e2e/auth.json' });

test.describe('phone 360', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  for (const path of routes) {
    test(`fits: ${path}`, async ({ page }) => {
      await page.goto(path);
      const main = page.locator('main').first();
      await expect(main).toBeVisible();

      const sideways = await main.evaluate((m) => m.scrollWidth - m.clientWidth);
      expect(sideways).toBeLessThanOrEqual(1);

      // drawer is closed by default
      const asideRight = await page.locator('#app-sidebar').evaluate((a) => a.getBoundingClientRect().right);
      expect(asideRight).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('leaving Roles keeps the app alive', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.locator('#app-sidebar a[href="/"]').first().click();
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('POS cart shows medicine names', async ({ page }) => {
    await page.goto('/pharmacy');
    const width = await page.locator('main table thead th').nth(1)
      .evaluate((th) => th.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(120);
  });
});
```

Last pass should be on a real iPhone (Safari) and a mid-range Android (Chrome) for focus zoom, the toolbar and the drawer feel.
