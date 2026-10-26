/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf6',
          100: '#d8f3e9',
          200: '#b3e6d4',
          300: '#7fd2b9',
          400: '#48b799',
          500: '#249c7f',
          600: '#167e67',
          700: '#136554',
          800: '#125145',
          900: '#10433a',
          950: '#072620',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)',
        lift: '0 2px 4px rgb(15 23 42 / 0.04), 0 16px 40px -12px rgb(15 23 42 / 0.18)',
        panel: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        glow: '0 8px 24px -8px rgb(22 126 103 / 0.55)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        progress: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
        flash: { '0%, 60%': { backgroundColor: 'rgb(209 250 229 / 0.9)' }, '100%': { backgroundColor: 'transparent' } },
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
