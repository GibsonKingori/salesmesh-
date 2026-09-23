/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Light by default; any element with class="dark" (header, login brand panel) flips its subtree
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        // Semantic surface/text colours, defined as CSS variables in index.css so the same
        // class reads well in both the light content area and the dark brand areas
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          soft: 'rgb(var(--fg-soft) / <alpha-value>)',
        },
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        // Neutrals with a slight green-blue tint, so surfaces sit with the emerald brand
        ink: {
          50: '#f2f6f6',
          100: '#e1e8e8',
          200: '#c4d0d0',
          300: '#9cadad',
          400: '#728787',
          500: '#526767',
          600: '#3c4e4f',
          700: '#2a393a',
          800: '#182425',
          900: '#0d1617',
          950: '#060c0d',
        },
        // Emerald — the green of the Kenyan flag, tuned for dark UI
        brand: {
          50: '#eafff7',
          100: '#cbffea',
          200: '#9bf7d6',
          300: '#5eeabd',
          400: '#26d3a0',
          500: '#0db888',
          600: '#03966f',
          700: '#04775b',
          800: '#085e49',
          900: '#094d3d',
        },
        // Savanna gold — used sparingly for highlights and growth
        accent: {
          300: '#fcd679',
          400: '#f9c243',
          500: '#f2a81d',
          600: '#d6860f',
        },
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: 0, transform: 'translateY(14px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fadeIn 0.4s ease-out both',
        'slide-in-right': 'slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
