/**
 * Every style uses the design tokens: raw colours, font families and font sizes are only
 * allowed in src/shell/theme/tokens.css (the values copied from the Claude Design handoff).
 */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
    ],
    'declaration-property-value-allowed-list': {
      'font-size': ['/^var\\(--fs-[0-9-]+\\)$/', 'inherit'],
      'font-family': ['/^var\\(--font-(sans|mono)\\)$/', 'inherit'],
      font: ['inherit'],
    },
    // CSS Modules: classes are camelCase so they read as JS properties.
    'selector-class-pattern': '^[a-z][a-zA-Z0-9]*$|^uv-[a-z-]+$',
    'keyframes-name-pattern': '^uv-[a-z-]+$',
  },
  overrides: [
    {
      files: ['src/shell/theme/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        // Keep the prototype's exact oklch() spelling.
        'lightness-notation': null,
        'hue-degree-notation': null,
      },
    },
  ],
};
