# HWT Pharmacy: pharmacist workstation, mobile fix spec

**Build tested:** `index-DpnIry2z.js` (the deploy that went live around 12:28 today)
**Login:** Pharmacist role (11 permissions)
**Date:** 16 Sep 2026
**Widths:** 360 / 390 / 414 phones · 768 / 820 iPad portrait · 1024 iPad landscape · 1100 / 1280 laptop
**Pages:** Home, POS, Requisitions, Inventory, Vendors, Customers, Returns, Cash Flow, Day Close, plus Credit Accounts and Stock Audit from the More menu. Also the medicine lookup, the More menu itself, the vendor and customer detail panels, and two modals (Issue to a department, New medicine master).

Same method as the admin pass. Each route ran in a same-origin frame at exact widths, I measured the DOM, then checked it by eye. Your tab went to the background partway through, and background tabs don't fire resize events. So the one layout driven by JS (POS table vs cards) was re-checked by loading each width fresh.

Left out: real phones and iPads, a cart with items in it (I didn't want to touch stock), Day Close and register tables with real rows (no sales today), dark mode.

> **Heads-up:** your open tab still runs the build from before the deploy (`index-B0iOfdre.js`). Refresh it to see today's changes. That old file now returns `index.html` with a 200. That's harmless with a single bundle, but stale tabs will break if you ever code-split.

---

## Where it stands

The admin fixes carried over well. On all 11 pages the page body now fits a 360px screen. What's left is mostly the pharmacist top bar and tab nav, which the admin pass never covered.

Already working:
- **POS on phones:** card cart, fixed Pay bar, short billing labels, 44px cash buttons. The Medicine column is 150px at 768 and 406px at 1024.
- **Forms:** 16px, 44px-tall inputs on phones. Modals open as bottom sheets with a pinned footer.
- **Tables:** Inventory, Requisitions, Cash Flow and Stock Audit stack into cards.
- **Chrome:** the footer hides on phones, and shortcut chips carry `kbd-hint`.

| Priority | # | Problem | Where |
|---|---|---|---|
| P0 | 1 | Top bar is wider than a phone, Sign out is off-screen | Every page |
| P0 | 2 | More menu never appears, at any width | Every page |
| P1 | 3 | Nav hides the active tab and gives no scroll hint | Every page |
| P1 | 4 | Picking a record leaves its detail below the fold | Vendors, Customers |
| P1 | 5 | Vendor detail buttons run off-screen | Vendors |
| P1 | 6 | Expiry & Claims buckets stay in 4 columns | Home |
| P1 | 7 | Three dashboard tables still scroll sideways | Home |
| P1 | 8 | Stock Audit switches pharmacists to the admin layout | Stock Audit |
| P1 | 9 | Touch sizing stops at 1023px, iPads in landscape miss it | POS, Inventory, most pages |
| P1 | 10 | No touch way to register a customer, and the hint is wrong | Customers |
| P2 | 11 | Stacked inventory cards look scattered | Inventory |
| P2 | 12 | Leftover tap targets under 32px | Most pages |
| P2 | 13 | Three-column rows too tight on phones | Requisitions modal, Customers |
| P2 | 14 | Home runs 3,036px on a phone | Home |
| P2 | 15 | No connection indicator on phones | Every page |
| P2 | 16 | Copy and labels assume a keyboard | Inventory, Requisitions, Customers |
| P2 | 17 | Two tables still scroll on iPad portrait | Inventory, Cash Flow |
| P2 | 18 | Top bar grows to 69px at 1024 | Every page |

---

## P0

### 1. The top bar doesn't fit a phone

**Where:** the pharmacist header, `header > div.px-4.py-2.flex.items-center.justify-between.gap-4`. The brand block sits on the left (logo, HOPE WELFARE TRUST, the till chip, subtitle). The user block and buttons sit on the right in `div.flex.items-center.gap-3`, which is 282px wide. The connection chip and clock are `hidden lg:flex`, so they already vanish below 1024.

| Width | Bar height | Page wider than the screen by | Day Close | Sign out |
|---|---|---|---|---|
| 360 | 100px | 76px | 41px cut off | off-screen |
| 390 | 100px | 46px | 11px cut off | off-screen |
| 414 | 100px | 22px | fits | 7px showing |
| 768 | 52px | 0 | fits | fits |

The brand wraps to three lines, "No till open" wraps to three, and the user name overlaps the chip. Since the header makes the document wider than the screen, the whole app can be dragged sideways. Theme is 24×26 and Sign out 29×29.

**Fix:** on phones keep the logo, a short name, the till chip, a status dot, the avatar and Sign out. Day Close is already a nav tab, so drop it here. Move the theme switch into a menu.

```jsx
<header className="bg-white border-b border-slate-300 shadow-xs shrink-0 z-20 no-print">
  <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2 sm:gap-4">
    {/* brand: keep the existing onClick that goes Home */}
    <button type="button" aria-label="Home" className="flex items-center gap-2 sm:gap-2.5 text-left group min-w-0">
      <img src={logo} alt="" className="h-7 w-auto shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-bold text-slate-900 text-sm tracking-tight whitespace-nowrap">
            <span className="sm:hidden">HWT</span>
            <span className="hidden sm:inline">HOPE WELFARE TRUST</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold ...">{tillLabel}</span>
        </div>
        <div className="hidden sm:block truncate text-[11px] text-slate-500 leading-none mt-0.5">
          Hope Welfare Trust Pharmacy
        </div>
      </div>
    </button>

    {/* connection chip + clock: unchanged, lg and up */}
    <div className="hidden lg:flex items-center gap-4 text-xs text-slate-600">…</div>

    <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
      {/* below lg: status dot (item 15) */}
      <span
        role="status"
        aria-label={online ? 'Server connected' : 'Server unreachable'}
        className={`lg:hidden h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />

      <div className="flex items-center gap-2 sm:border-r sm:border-slate-200 sm:pr-3">
        <div className="hidden sm:block text-right">{/* name + role */}</div>
        <span className="h-7 w-7 rounded bg-slate-200 ...">{initial}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Night mode" className="hidden sm:inline-flex ...">☾</button>
        <button type="button" className="hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap ...">
          Day Close <kbd className="kbd-hint ...">F10</kbd>
        </button>
        <button
          type="button"
          title="Sign out"
          aria-label="Sign out"
          className="inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center ..."
        >
          {/* existing icon */}
        </button>
      </div>
    </div>
  </div>
</header>
```

At 360 that row needs about 255px of the 336px available. Give phones a way to reach the theme switch, for example a small menu on the avatar.

### 2. The More menu never shows

**Where:** the tab nav, `nav.bg-slate-50.border-b.border-slate-300.px-3.flex.items-center.gap-1.shrink-0.overflow-x-auto`. The More button and its dropdown both live inside it. `overflow-x: auto` clips the other axis too, so the dropdown renders inside a 33px scroll box.

Measured at 390 and 1100: after clicking More, the Credit Accounts link sits 36px below the nav's bottom edge. A hit test at that spot lands on the page underneath. Your current tab (the older build) does the same thing, so this bug was there before today's deploy.

Result: Credit Accounts and Stock Audit have no working link in the nav. Home still works through the logo.

**Fix:** only the tab strip should scroll, so move More outside it. The same component also handles item 3.

```jsx
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export function WorkstationNav({ tabs, moreTabs }) {
  const { pathname } = useLocation();
  const stripRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // item 3: keep the current tab in view; close More after navigating
  useEffect(() => {
    setMoreOpen(false);
    stripRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav className="bg-slate-50 border-b border-slate-300 px-3 flex items-stretch gap-1 shrink-0 no-print">
      <div ref={stripRef} className="nav-strip flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={/* current tab classes */ 'py-3 sm:py-2'}>
            {t.label}
          </NavLink>
        ))}
      </div>

      <div className="relative shrink-0 flex items-center">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="min-h-[44px] sm:min-h-0 px-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          More ▾
        </button>

        {moreOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-40 min-w-[11rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          >
            {moreTabs.map((t) => (
              <NavLink key={t.to} to={t.to} role="menuitem" className="block px-3 py-3 sm:py-2 text-sm hover:bg-slate-50">
                {t.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
```

Keep whatever outside-click and Esc handling the menu has today.

---

## P1

### 3. The nav hides where you are

At 390 the tab strip is 710px wide. Returns starts at 395px, Cash Flow at 464px, Day Close at 548px and More at 631px, so all four are past the edge. On the Returns page, its underline is off-screen. Nothing hints that the strip scrolls. Tabs are 32 to 34px tall.

**Fix:** the `scrollIntoView` effect and `py-3 sm:py-2` from item 2, plus the edge fade on `.nav-strip` in the CSS below.

### 4. Detail panels open out of sight

On phones, Vendors and Customers put the list above the detail. Tapping a vendor or a customer didn't move the page. The page grew (Vendors 895 to 1,244px, Customers 924 to 1,213px), but the detail landed below the fold, so the tap looks dead. Requisitions stacks its slip inspector the same way. There were no slips to test with.

The Roles page already scrolls its editor into view. Turn that into a hook and reuse it:

```js
import { useEffect, useRef } from 'react';

// Use the breakpoint where the list/detail grid stacks (Roles uses 1279px).
export function useRevealOnSelect(selectedId, query = '(max-width: 1279px)') {
  const ref = useRef(null);

  useEffect(() => {
    if (!selectedId || !window.matchMedia(query).matches) return undefined;
    const timer = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedId, query]);

  return ref;
}

// const detailRef = useRevealOnSelect(selectedVendor?.id);
// <section ref={detailRef}>…vendor detail…</section>
```

Put a "Back to list" button at the top of each detail on phones (`lg:hidden`).

### 5. Vendor detail buttons run off-screen

**Where:** after picking a vendor, the row holding Statement, Pay (Alt+P), Reclaim and Goods received (GRN) is `div.flex.items-center.gap-1.5`, 468px wide. At 390 the page then scrolls 103px sideways and "Goods received (GRN)" is cut off.

```diff
- flex items-center gap-1.5
+ flex flex-wrap items-center gap-1.5
```

### 6. Expiry & Claims stays in four columns

**Where:** Home, Expiry & Claims card, `div.grid.grid-cols-4.gap-2.p-4.border-b.border-slate-100`. At 390 each bucket is 77px. Labels wrap to three lines, and "CLAIMABLE" (76px) spills out of its 52px text box. A `.ph-buckets` rule already switches to two columns under 620px, but this grid doesn't use that class.

```diff
- grid grid-cols-4 gap-2 p-4 border-b border-slate-100
+ grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 border-b border-slate-100
```

### 7. Home tables still scroll sideways

At 390 each card has 365px to work with:

| Card | Columns | Table width |
|---|---|---|
| Today's Dispensing Register | 6 | 454px |
| Reorder List | 5 | 418px |
| Expiry & Claims | 6 | 495px |

Column headers wrap to three lines ("USED (30 D)"). At 1024 the Expiry & Claims table still pokes 9px past its 486px card.

**Fix:** give all three the same `table-stack` + `data-label` treatment Inventory has. Reorder List and Expiry & Claims carry real rows, so start there. For the 9px at 1024, trimming cell padding or hiding one column at `lg` is enough.

### 8. Stock Audit flips pharmacists into the admin layout

The root layout sends some paths to the sidebar shell even for non-managers: `['/admin', '/reports', '/margin', '/amend', '/dialysis', '/stock-audit']`. The Pharmacist role has `inventory.manage`, so Stock Audit opens with the hamburger header and the drawer, and the top tabs vanish. The drawer also names pages differently: Pharmacy Counter vs POS, Departments vs Requisitions, Customers & Cards vs Customers, Dashboard vs Home. On that page two stat labels are cut off ("TOTAL FORMULARY…", "DISCREPANCY VARIANCE…").

**Fix:** only route admin-only pages to the sidebar shell. The list has a different name in your source, so grep for `'/stock-audit'` next to `'/margin'`.

```diff
- const SIDEBAR_PATHS = ['/admin', '/reports', '/margin', '/amend', '/dialysis', '/stock-audit'];
+ const SIDEBAR_PATHS = ['/admin', '/reports', '/margin', '/amend'];
```

`/dialysis` has the same effect on any non-manager with `dialysis.view`. Then use one set of page names in both navs, and switch those stat labels to `line-clamp-2`.

### 9. Touch sizing stops at 1023px

Control sizes only grow below 1024px:

```css
@media (max-width: 1023px) { .ws-content, .admin-content { --ctl-h: 2.75rem; --btn-fs: 13px; } }
```

The pharmacist shell starts from `--ctl-h: 2rem` and `--ctl-fs: 12px`, so an iPad in landscape (1024 to 1366px) gets desktop density. On POS at 1024: tender buttons are 30px, quick-cash buttons 26px, billing-mode buttons 28px, eight labels are 11px, and inputs are 12 and 14px. Inventory at 1024 has 26 targets under 32px.

**Fix:** also size by pointer type (CSS patch below). For buttons sized with Tailwind classes, add a `touch` screen:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      screens: {
        touch: { raw: '(hover: none) and (pointer: coarse)' },
      },
    },
  },
};
```

Then write `min-h-[44px] lg:min-h-0 touch:min-h-[44px]`. Screens added through `extend` go to the end of the list, so `touch:` beats `lg:`.

### 10. Registering a customer needs a keyboard

The Customers page has no New or Register button. The only way in is Alt+N, and that only works with `patient.manage`. The Pharmacist role doesn't have that permission, yet the empty state reads: "Find them by mobile on the left, or press Alt+N to register one." On a phone the search box is above the panel, not to its left, and Alt+N does nothing for this role.

**Fix:**

```jsx
{can('patient.manage') && (
  <button type="button" onClick={() => setRegisterOpen(true)} className="ws-btn ...">
    + Register customer <kbd className="kbd-hint">Alt+N</kbd>
  </button>
)}

<p>
  Search by mobile or name to open an account.
  {can('patient.manage') && ' Or use Register customer to add one.'}
</p>
```

---

## P2

### 11. Stacked inventory cards look scattered

The cards work, with three rough edges:
- The first cell has no label, so the name and the formula sit side by side in two narrow columns.
- Two-part values ("200" plus "2 box · reorder 100", or the two price lines) get pushed to opposite edges by `justify-content: space-between`.
- Labels inherit the cell's font, so "DRAP reg" and "Price / MRP" render in JetBrains Mono.

**Fix:** mark the name cell as the card title, wrap two-part values in one element, and set the label font (CSS patch below).

```jsx
<td className="stack-title">{/* name + formula */}</td>

<td data-label="On hand">
  <div className="cell">
    <div>{onHand}</div>
    <div className="text-slate-500">{packs} · reorder {reorderAt}</div>
  </div>
</td>
```

### 12. Tap targets still under 32px

| Where | What | Size |
|---|---|---|
| Top bar | Theme, Sign out | 24×26, 29×29 |
| Nav | tabs | 32-34px tall |
| Home | "Open the requisition queue" link on phones; "Process a return", "View the day book" on tablets | 16px tall |
| Inventory | SHOW chip on the stock-out tile | 48×20 |
| Requisitions | Awaiting dispense / All slips / Departments | 28px tall |
| Vendors | + New, filter chips | 28px tall |
| Customers | All accounts / Welfare cards / Staff / Balance due | 28px tall |
| Cash Flow | "Filter cashier or counter" input | 192×28 |
| Credit Accounts | "Only those who owe" checkbox row | 142×17 |

**Fix:** use `min-h-[44px] sm:min-h-0` (or `touch:min-h-[44px]`) on the chips and tabs, `w-full h-11` on the Cash Flow filter, and `py-3` on the Credit checkbox label. Give the home links `inline-flex min-h-[44px] items-center`.

### 13. Three columns that don't fit

- **Issue to a department modal:** `grid grid-cols-3 gap-2` (Patient / ward / bed, MR number, Slip serial) leaves 111px per column. Labels wrap unevenly and the inputs don't line up. Use `grid-cols-1 sm:grid-cols-3`.
- **Customer detail:** the `grid grid-cols-3 gap-2 p-3` stat row makes 108px tiles, and "LIFETIME AT THIS COUNTER" runs to three lines. Use `grid-cols-2 sm:grid-cols-3`, with `col-span-2 sm:col-span-1` on the third tile.

### 14. Home is long on a phone

Home is 3,036px at 390 (3,136px at 360) across ten sections. The welcome card alone is 191px, and the lookup starts 244px down the content area. On phones, cut the welcome card to one line so lookup and today's numbers show first. Keep the hub, register, reorder and expiry cards after that, and fold Ward & Unit Indents, Moving Today and the Controlled Drug Register behind a "More for today" toggle below `md`.

### 15. No connection state on phones

The connection chip is `hidden lg:flex` and the footer is `hidden md:flex`. Below 768px nothing shows whether the server is reachable until the "Cannot reach the pharmacy server" dialog pops up. The status dot in item 1 fixes this.

### 16. Wording that assumes a keyboard

- **Inventory:** tapping Receive stock / GRN with nothing selected says to pick the medicine first, "then press F3 to receive stock into it".
- **Requisitions:** "Pick one from the queue, or press Enter on the highlighted row."
- **Customers:** besides item 10, the detail's close button is "×" plus a `kbd-hint` "Esc", with no `aria-label`. On touch the hint hides, so screen readers just get "×". Add `aria-label="Close"`.

A small helper keeps copy honest:

```js
export const isTouch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// isTouch() ? 'Select a medicine, then tap Receive.' : 'Pick the medicine first, then press F3.'
```

### 17. Two tables still scroll on iPad portrait

`table-stack` only applies below 768px. At 768 the Inventory table is 796px in a 742px box and Cash Flow is 830px in 742px. Add `table-pin-first` to both so the name column stays put while the rest scrolls.

### 18. The top bar grows at 1024

At 1024 the connection chip and clock appear. The brand wraps to two lines (262×53) and so does Day Close (100×42), which makes the bar 69px instead of 52px. The `whitespace-nowrap` in item 1 fixes both.

---

## CSS to append

Add this after the admin patch at the end of the main CSS file.

```css
/* ===== Pharmacist shell patch ===== */

/* 9. touch sizing on any touch screen, including iPads in landscape */
@media (hover: none) and (pointer: coarse) {
  .ws-content,
  .admin-content {
    --ctl-h: 2.75rem;
    --ctl-fs: 16px;
    --btn-fs: 13px;
  }

  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
  select,
  textarea { font-size: 16px !important; }
}

/* 3. fade the right edge so the tab strip reads as scrollable */
@media (max-width: 767px) {
  .nav-strip {
    padding-right: 24px;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
            mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  }

  .nav-strip::-webkit-scrollbar { display: none; }
}

/* 11. stacked cards */
@media (max-width: 767px) {
  .table-stack > tbody > tr > td.stack-title {
    display: block;
    text-align: left;
    padding-bottom: 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--line, #e2e8f0);
  }

  .table-stack > tbody > tr > td.stack-title::before { content: none; }

  .table-stack > tbody > tr > td::before {
    flex-shrink: 0;
    font-family: Inter, system-ui, sans-serif;
  }

  .table-stack > tbody > tr > td > .cell {
    min-width: 0;
    text-align: right;
  }
}
```

| Class | Goes on |
|---|---|
| `nav-strip` | the scrolling tab row in the pharmacist nav (item 2) |
| `stack-title` | the product cell in Inventory, and the title cell of any other stacked table |
| `cell` | the wrapper around two-part values in stacked tables |

---

## Page by page

Items 1, 2, 3 and 15 affect every page. Items 9 and 12 affect most of them.

| Page | Route | Phone (360 / 390) | iPad portrait (768) | iPad landscape (1024) | Items |
|---|---|---|---|---|---|
| Home | `/` | Body fits. 4-column buckets, 3 tables scroll, 3,036px long | Fits | Expiry table 9px over | 6, 7, 12, 14 |
| POS | `/pharmacy` | Good: cards, Pay bar, 16px inputs | Medicine column 150px. Billing buttons 28px, inputs 12-14px | Medicine 406px. Buttons 26-30px, inputs 12-14px | 9 |
| Requisitions | `/departments` | Fits. 28px tabs, tight modal row | Fits | Fits | 4, 12, 13, 16 |
| Inventory | `/inventory` | Fits. Card rough edges, 20px SHOW chip | Table 54px over | 26 small targets | 11, 12, 16, 17 |
| Vendors | `/vendors` | List fits. Detail row 103px over, detail below the fold | List fits | List fits | 4, 5, 12 |
| Customers | `/customers` | Fits. No register button, detail below the fold, tight stats | Fits | Fits | 4, 10, 12, 13, 16 |
| Returns | `/returns` | Fits. Its tab sits off-screen | Fits | Fits | 3 |
| Cash Flow | `/cashflow` | Fits. 28px filter input | Table 88px over | Fits | 12, 17 |
| Day Close | `/pharmacy-close` | Fits (no sales to fill its tables) | Fits | Fits | none |
| Credit Accounts | `/credit` | Fits. 17px checkbox row. Only linked from More | Fits | Fits | 2, 12 |
| Stock Audit | `/stock-audit` | Fits, but in the admin layout. Two labels cut | Admin layout | Admin layout | 2, 8 |

---

## Retest

**Console check.** Open DevTools with the device toolbar at 360px and run this on each page. Both numbers should be 0. The first one would have caught items 1 and 5.

```js
[
  document.documentElement.scrollWidth - document.documentElement.clientWidth,
  document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth,
];
```

**Playwright.** Save a pharmacist session once (log in as the pharmacist when the browser opens):
`npx playwright codegen http://localhost:4000 --save-storage=e2e/auth-pharmacist.json`

```ts
// e2e/pharmacist-mobile.spec.ts
import { test, expect } from '@playwright/test';

const routes = [
  '/', '/pharmacy', '/departments', '/inventory', '/vendors', '/customers',
  '/returns', '/cashflow', '/pharmacy-close', '/credit', '/stock-audit',
];

test.use({ storageState: 'e2e/auth-pharmacist.json' });

test.describe('pharmacist on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  for (const path of routes) {
    test(`nothing scrolls sideways: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main').first()).toBeVisible();

      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow.doc).toBeLessThanOrEqual(1);
      expect(overflow.main).toBeLessThanOrEqual(1);
    });
  }

  test('Sign out is on screen', async ({ page }) => {
    await page.goto('/');
    const box = await page.getByRole('button', { name: 'Sign out' }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });
});

test.describe('pharmacist on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('More menu opens and its links work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /More/ }).click();
    await page.locator('nav').getByText('Credit Accounts', { exact: true }).click();
    await expect(page).toHaveURL(/\/credit$/);
  });
});
```

Finish on a real iPhone in Safari and on an iPad in both orientations.
