import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // DEPARTIFY palette — calm, professional, single accent.
        // Deliberately not the AI-default warm cream + terracotta nor
        // the broadsheet hairline. Inspired by Attio's quiet surfaces
        // and Linear's measured contrast.
        ink: {
          50:  '#F8F8F4',
          100: '#F0F0EA',
          200: '#E2E2DA',
          300: '#C8C8BD',
          400: '#9C9C90',
          500: '#6E6E63',
          600: '#52524A',
          700: '#3A3A33',
          800: '#26261F',
          900: '#16160F',
        },
        lime: {
          50:  '#F4F8E6',
          100: '#E5EEC2',
          200: '#CFE39A',
          300: '#B7D670',
          400: '#9EC84B',
          500: '#7FAB33',
          600: '#5F8722',
          700: '#476519',
          800: '#2F4510',
          900: '#1A2708',
        },
        signal: {
          warn: '#C28B1B',
          bad: '#B43A2D',
          ok: '#3E8B5A',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
      },
      boxShadow: {
        card: '0 1px 0 rgba(22,22,15,0.04), 0 4px 16px -8px rgba(22,22,15,0.10)',
        pop: '0 4px 24px -6px rgba(22,22,15,0.18)',
        ring: '0 0 0 3px rgba(126,171,51,0.18)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
