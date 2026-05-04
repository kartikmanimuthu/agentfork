'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { themes } from '@/components/settings/theme-registry';

export interface ThemeConfig {
  theme: string;
  radius: number;
  font: string;
}

const defaultConfig: ThemeConfig = {
  theme: 'zinc',
  radius: 0.5,
  font: 'geist',
};

type ThemeConfigContextType = {
  config: ThemeConfig;
  setConfig: (config: ThemeConfig) => void;
};

const ThemeConfigContext = React.createContext<ThemeConfigContextType>({
  config: defaultConfig,
  setConfig: () => {},
});

export function ThemeConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = React.useState<ThemeConfig>(defaultConfig);
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme: mode } = useTheme();

  React.useEffect(() => {
    const savedConfig = localStorage.getItem('theme-config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfigState({ ...defaultConfig, ...parsed });
      } catch (e) {
        console.error('Failed to parse theme config', e);
      }
    }
    setMounted(true);
  }, []);

  const setConfig = React.useCallback((newConfig: ThemeConfig) => {
    setConfigState(newConfig);
    localStorage.setItem('theme-config', JSON.stringify(newConfig));
  }, []);

  React.useEffect(() => {
    const theme = themes.find((t) => t.name === config.theme);
    if (!theme) return;

    const root = document.documentElement;
    const isDark = mode === 'dark';
    const cssVars = isDark ? theme.cssVars.dark : theme.cssVars.light;

    Object.entries(cssVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.style.setProperty('--radius', `${config.radius}rem`);

    let fontVar = 'var(--font-geist-sans)';
    if (config.font === 'system') fontVar = 'system-ui';
    root.style.setProperty('--font-sans', fontVar);
  }, [config, mode]);

  return (
    <ThemeConfigContext.Provider value={{ config, setConfig }}>
      {children}
    </ThemeConfigContext.Provider>
  );
}

export function useThemeConfig() {
  return React.useContext(ThemeConfigContext);
}
