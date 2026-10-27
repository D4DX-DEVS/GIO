/** @type {import('tailwindcss').Config} */
// One palette for the whole app, taken from the public website tokens in
// site.css: wine/maroon for actions, warm ivory and beige neutrals, muted rose.
// `slate` is redefined as the warm neutral scale so every admin screen
// follows the same theme without per-class changes.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f7ebe8',
          100: '#f1e0de',
          200: '#e3c6c4',
          300: '#c48b93',
          400: '#b06a76',
          500: '#9a4655',
          600: '#5a0b16',
          700: '#701526',
          800: '#4a0912',
          900: '#3b0911',
          950: '#24070c',
        },
        slate: {
          50: '#faf6f0',
          100: '#f3ebe0',
          200: '#e5d9cb',
          300: '#cdb9a5',
          400: '#a8968f',
          500: '#685a59',
          600: '#524546',
          700: '#3b2a2c',
          800: '#2b2326',
          900: '#241417',
          950: '#1a0e10',
        },
      },
      fontFamily: {
        // Outfit everywhere; `serif` is kept as an alias so display headings need no class changes.
        sans: ['"Outfit Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'sans-serif'],
        serif: ['"Outfit Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(60 10 18 / 0.04), 0 4px 16px -4px rgb(60 10 18 / 0.08)',
        lift: '0 2px 4px rgb(60 10 18 / 0.04), 0 18px 44px -14px rgb(60 10 18 / 0.22)',
        panel: '0 1px 2px rgb(60 10 18 / 0.03), 0 1px 3px rgb(60 10 18 / 0.05)',
        glow: '0 10px 24px -12px rgb(90 11 22 / 0.6)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        progress: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
        flash: { '0%, 60%': { backgroundColor: 'rgb(241 224 222 / 0.9)' }, '100%': { backgroundColor: 'transparent' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-up': 'fade-up 250ms ease-out both',
        'pop-in': 'pop-in 160ms ease-out',
        'sheet-up': 'sheet-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-in': 'slide-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        shimmer: 'shimmer 1.4s infinite',
        progress: 'progress 1.1s ease-in-out infinite',
        flash: 'flash 2.4s ease-out',
      },
    },
  },
  plugins: [],
};
