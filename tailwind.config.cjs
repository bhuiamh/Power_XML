/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2596be',
          50: '#e6f5fa',
          100: '#ccebf5',
          200: '#99d7eb',
          300: '#66c3e1',
          400: '#33afd7',
          500: '#2596be',
          600: '#1e7a9a',
          700: '#175e76',
          800: '#104252',
          900: '#08262e'
        }
      }
    }
  },
  plugins: []
};
