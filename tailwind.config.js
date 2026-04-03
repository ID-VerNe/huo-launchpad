module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      gridTemplateColumns: {
        '10': 'repeat(10, minmax(0, 1fr))',
      },
      gridTemplateRows: {
        '5': 'repeat(5, minmax(0, 1fr))',
      }
    },
  },
  plugins: [],
}
