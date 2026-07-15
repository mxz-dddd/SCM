import { describe, expect, it } from 'vitest';
import {
  applyScmCssVariables,
  scmAntdTheme,
  scmCssVariables,
  scmTokens,
} from './tokens';

describe('SCM design tokens', () => {
  it('exports the complete original token baseline', () => {
    expect(Object.keys(scmTokens)).toEqual(
      expect.arrayContaining([
        'border',
        'color',
        'density',
        'font',
        'motion',
        'radius',
        'shadow',
        'spacing',
        'status',
        'surface',
        'text',
        'zIndex',
      ]),
    );
    expect(scmAntdTheme.token.colorPrimary).toBe(scmTokens.color.accentStrong);
  });

  it('applies the same values through CSS custom properties', () => {
    const properties = new Map<string, string>();
    const target = {
      style: {
        setProperty: (name: string, value: string) =>
          properties.set(name, value),
      },
    } as unknown as HTMLElement;
    applyScmCssVariables(target);
    expect(properties.get('--scm-color-accent')).toBe(
      scmCssVariables['--scm-color-accent'],
    );
  });
});
