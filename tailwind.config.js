/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Kolory marki Bioerg. Używane na akcenty, przyciski i oznaczenia statusów -
        // nie na duże wypełnienia tła, bo to narzędzie robocze, czytane codziennie.
        limonka: {
          DEFAULT: '#C4E82A',
          ciemna: '#8FAE0F',
          jasna: '#EEF9C4',
        },
        blekit: {
          DEFAULT: '#5EC8F0',
          ciemny: '#1B86B4',
          jasny: '#DFF3FB',
        },
      },
    },
  },
  plugins: [],
}
