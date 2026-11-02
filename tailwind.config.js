/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#E8590C', dark: '#C2410C' } },
    },
  },
  plugins: [],
};
