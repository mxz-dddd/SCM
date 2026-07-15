export const scmTokens = {
  border: {
    default: '#d8e0ea',
    strong: '#bcc8d6',
  },
  color: {
    accent: '#42c7a5',
    accentStrong: '#138a73',
    danger: '#c33b45',
    info: '#326fd1',
    success: '#16845b',
    warning: '#b06b16',
  },
  density: {
    comfortable: 40,
    compact: 32,
    touch: 48,
  },
  font: {
    family:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    size: { body: 14, caption: 12, title: 24 },
    weight: { regular: 400, semibold: 600, strong: 800 },
  },
  motion: {
    durationFast: '120ms',
    durationNormal: '200ms',
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  radius: { pill: 999, sm: 6, md: 10, lg: 14 },
  shadow: {
    bottomNav: '0 -8px 24px rgb(16 37 54 / 8%)',
    floating: '0 18px 48px rgb(13 31 48 / 18%)',
    focus: '0 0 0 3px rgb(66 199 165 / 24%)',
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
  status: {
    errorBackground: '#fff0f0',
    infoBackground: '#edf4ff',
    successBackground: '#e7f8f0',
    warningBackground: '#fff6e8',
  },
  surface: {
    app: '#f1f5f8',
    elevated: '#ffffff',
    muted: '#f7f9fb',
    sidebar: '#102536',
    sidebarRaised: '#183449',
  },
  text: {
    inverse: '#f5fbff',
    muted: '#65758a',
    primary: '#172739',
    sidebar: '#b7c8d7',
  },
  zIndex: { header: 20, overlay: 1000, toast: 1100 },
} as const;

export const scmAntdTheme = {
  token: {
    borderRadius: scmTokens.radius.sm,
    colorBgBase: scmTokens.surface.elevated,
    colorBgLayout: scmTokens.surface.app,
    colorBorder: scmTokens.border.default,
    colorError: scmTokens.color.danger,
    colorInfo: scmTokens.color.info,
    colorPrimary: scmTokens.color.accentStrong,
    colorSuccess: scmTokens.color.success,
    colorText: scmTokens.text.primary,
    colorTextSecondary: scmTokens.text.muted,
    colorWarning: scmTokens.color.warning,
    controlHeight: scmTokens.density.comfortable,
    fontFamily: scmTokens.font.family,
    fontSize: scmTokens.font.size.body,
  },
} as const;

export const scmCssVariables = {
  '--scm-border-default': scmTokens.border.default,
  '--scm-border-strong': scmTokens.border.strong,
  '--scm-color-accent': scmTokens.color.accent,
  '--scm-color-accent-strong': scmTokens.color.accentStrong,
  '--scm-color-danger': scmTokens.color.danger,
  '--scm-color-info': scmTokens.color.info,
  '--scm-color-success': scmTokens.color.success,
  '--scm-color-warning': scmTokens.color.warning,
  '--scm-font-family': scmTokens.font.family,
  '--scm-font-size-caption': `${scmTokens.font.size.caption}px`,
  '--scm-motion-fast': scmTokens.motion.durationFast,
  '--scm-motion-normal': scmTokens.motion.durationNormal,
  '--scm-motion-easing': scmTokens.motion.easing,
  '--scm-radius-lg': `${scmTokens.radius.lg}px`,
  '--scm-radius-md': `${scmTokens.radius.md}px`,
  '--scm-radius-pill': `${scmTokens.radius.pill}px`,
  '--scm-radius-sm': `${scmTokens.radius.sm}px`,
  '--scm-shadow-floating': scmTokens.shadow.floating,
  '--scm-shadow-focus': scmTokens.shadow.focus,
  '--scm-shadow-bottom-nav': scmTokens.shadow.bottomNav,
  '--scm-space-1': `${scmTokens.spacing[1]}px`,
  '--scm-space-2': `${scmTokens.spacing[2]}px`,
  '--scm-space-3': `${scmTokens.spacing[3]}px`,
  '--scm-space-4': `${scmTokens.spacing[4]}px`,
  '--scm-space-5': `${scmTokens.spacing[5]}px`,
  '--scm-space-6': `${scmTokens.spacing[6]}px`,
  '--scm-space-8': `${scmTokens.spacing[8]}px`,
  '--scm-status-error-bg': scmTokens.status.errorBackground,
  '--scm-status-info-bg': scmTokens.status.infoBackground,
  '--scm-status-success-bg': scmTokens.status.successBackground,
  '--scm-status-warning-bg': scmTokens.status.warningBackground,
  '--scm-surface-app': scmTokens.surface.app,
  '--scm-surface-elevated': scmTokens.surface.elevated,
  '--scm-surface-muted': scmTokens.surface.muted,
  '--scm-surface-sidebar': scmTokens.surface.sidebar,
  '--scm-surface-sidebar-raised': scmTokens.surface.sidebarRaised,
  '--scm-text-inverse': scmTokens.text.inverse,
  '--scm-text-muted': scmTokens.text.muted,
  '--scm-text-primary': scmTokens.text.primary,
  '--scm-text-sidebar': scmTokens.text.sidebar,
  '--scm-z-header': String(scmTokens.zIndex.header),
  '--scm-z-overlay': String(scmTokens.zIndex.overlay),
  '--scm-z-toast': String(scmTokens.zIndex.toast),
} as const;

export function applyScmCssVariables(target: HTMLElement): void {
  for (const [name, value] of Object.entries(scmCssVariables)) {
    target.style.setProperty(name, value);
  }
}
