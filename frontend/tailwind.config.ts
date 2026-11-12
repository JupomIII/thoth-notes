/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#faf8f4',
          raised: '#fffdfa',
          sunken: '#f2eee7',
        },
        ink: {
          DEFAULT: '#1f1d1a',
          soft: '#4a463f',
          muted: '#7c766b',
          faint: '#a8a196',
        },
        line: {
          DEFAULT: '#e2dcf0',
          strong: '#d3ccbe',
        },
        accent: {
          DEFAULT: '#4a6156',
          soft: '#e7ede9',
          strong: '#364a41',
        },
        danger: '#9b4b3f',
      },
      fontFamily: {
        ui: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(31, 29, 26, 0.05), 0 8px 24px rgba(31, 29, 26, 0.06)',
        float: '0 2px 6px rgba(31, 29, 26, 0.08), 0 16px 40px rgba(31, 29, 26, 0.12)',
      },
      spacing: {
        safe: 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
};
