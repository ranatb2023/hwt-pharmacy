/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand primary — #086bd7
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
      },
      fontFamily: {
        sans: ['"Nunito Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
