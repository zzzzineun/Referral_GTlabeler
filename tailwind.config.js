/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Malgun Gothic"', '"맑은 고딕"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
