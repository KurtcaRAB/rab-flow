/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      // Rocklea Abrasive Blasting colours, taken from the company logo.
      colors: {
        brand: { DEFAULT: '#FFF200', dark: '#E6DA00' },
        ink: { DEFAULT: '#231F20', soft: '#3A3536' },
      },
    },
  },
  plugins: [],
};
