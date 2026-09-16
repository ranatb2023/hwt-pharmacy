/** @type {import('tailwindcss').Config} */
//
// The workstation design (hwt-client/design/stitch) is built on Tailwind's slate
// scale with two named accents. Those mockups load Tailwind and their fonts from
// a CDN, which cannot work here: the site has no internet. Everything below is
// resolved at build time and the fonts are self-hosted through @fontsource, the
// same way Nunito Sans already was.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Any touch-only screen, an iPad in landscape included, gets the 44px
      // targets that the width breakpoints alone would deny it (mobile spec,
      // item 9). Extended screens come last, so `touch:` beats `lg:`.
      screens: {
        touch: { raw: '(hover: none) and (pointer: coarse)' },
      },
      colors: {
        // Brand primary — #086bd7. Kept for the pages not yet restyled.
        primary: {
          DEFAULT: '#086bd7',
          50: '#eef5fe', 100: '#d8e8fc', 200: '#b4d1f9', 300: '#84b2f4',
          400: '#4a8bec', 500: '#086bd7', 600: '#0757b5', 700: '#084892',
          800: '#0b3d78', 900: '#0e3563',
        },
        // Brand secondary — #ffaa00
        secondary: {
          DEFAULT: '#ffaa00',
          50: '#fff8e6', 100: '#ffedbf', 200: '#ffdd85', 300: '#ffcb4d',
          400: '#ffba24', 500: '#ffaa00', 600: '#d98600', 700: '#b36700',
          800: '#8f5100', 900: '#5f3600',
        },
        // The workstation accents, named as the design names them.
        clinical: {
          primary: '#0369a1', // the action blue on every "complete / post / save" button
          dark: '#075985',
          border: '#cbd5e1',
        },
        navy: {
          800: '#1e293b',
          900: '#0f172a', // the dark "amount payable" panel and the status footer
          950: '#090d16',
        },
        // Phase 10 — the management frame's palette, as DESIGN.md and the
        // executive dashboard mockup name it. The sidebar is `hwt.navy`, its
        // hover `hwt.hover`, its rules `hwt.line`; `hwt.sky` is the action blue.
        hwt: {
          navy: '#0b1f3d', deep: '#0f2d59', ink: '#08172c', ink2: '#08182e',
          line: '#15345f', hover: '#122e54', sky: '#0284c7', amber: '#f59e0b',
        },
      },
      fontFamily: {
        // Inter for text, JetBrains Mono for anything a cashier has to read as a
        // number: amounts, bill numbers, batch codes, the clock. A figure in a
        // proportional face is what makes 1,180 and 1,100 look alike at a glance.
        sans: ['Inter', '"Nunito Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        // Manrope for headlines and screen titles — DESIGN.md's "headline" face.
        headline: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
      },
    },
  },
  plugins: [],
};
