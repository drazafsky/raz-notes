const themeColor = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        gothic: '#79909A',
        rust: '#B15A35',
        porcelain: '#F1F3F3',
        creole: '#190800',
        theme: {
          bg: themeColor('--theme-bg'),
          surface: themeColor('--theme-surface'),
          text: themeColor('--theme-text'),
          muted: themeColor('--theme-muted'),
          brand: themeColor('--theme-brand'),
          'brand-soft': themeColor('--theme-brand-soft'),
          border: themeColor('--theme-border'),
          'on-brand': themeColor('--theme-on-brand'),
          accent: themeColor('--theme-accent'),
          'accent-soft': themeColor('--theme-accent-soft'),
          'accent-border': themeColor('--theme-accent-border'),
          'on-accent': themeColor('--theme-on-accent'),
          backdrop: themeColor('--theme-backdrop'),
        },
      },
    },
  },
  plugins: [],
};
