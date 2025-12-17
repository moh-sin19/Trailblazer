/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        bush: {
          50: "#f0f7f3",
          100: "#d9efe3",
          200: "#b3dfc8",
          300: "#81caa7",
          400: "#4eae82",
          500: "#2e956a",
          600: "#217757",
          700: "#1b5d46",
          800: "#174b3a",
          900: "#123d30"
        }
      }
    },
  },
  plugins: [],
};
