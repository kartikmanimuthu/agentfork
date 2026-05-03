'use client';

import * as React from 'react';
import { Moon, Sun, Check } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useThemeConfig } from '@/components/theme-config-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { themes } from '@/components/settings/theme-registry';

export function ThemeSettings() {
  const { setTheme: setMode, resolvedTheme: mode } = useTheme();
  const { config, setConfig } = useThemeConfig();

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Theme Preferences</CardTitle>
          <CardDescription>Loading theme settings...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme Preferences</CardTitle>
          <CardDescription>Customize the look and feel of the application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Mode Picker */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="grid grid-cols-3 gap-2 max-w-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('light')}
                className={cn(mode === 'light' && 'border-2 border-primary')}
              >
                <Sun className="mr-2 h-4 w-4" />
                Light
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('dark')}
                className={cn(mode === 'dark' && 'border-2 border-primary')}
              >
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('system')}
                className={cn(mode === 'system' && 'border-2 border-primary')}
              >
                <span className="mr-2">💻</span>
                System
              </Button>
            </div>
          </div>

          {/* Color Picker */}
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {themes.map((theme) => {
                const isActive = config.theme === theme.name;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    key={theme.name}
                    onClick={() => setConfig({ ...config, theme: theme.name })}
                    className={cn('justify-start', isActive && 'border-2 border-primary')}
                  >
                    <span
                      className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={
                        {
                          backgroundColor: `hsl(${theme.activeColor[mode === 'dark' ? 'dark' : 'light']})`,
                        } as React.CSSProperties
                      }
                    >
                      {isActive && <Check className="h-3 w-3 text-white" />}
                    </span>
                    {theme.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Font Picker */}
          <div className="space-y-2">
            <Label>Font</Label>
            <div className="grid grid-cols-3 gap-2 max-w-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfig({ ...config, font: 'inter' })}
                className={cn(config.font === 'inter' && 'border-2 border-primary')}
                style={{ fontFamily: 'var(--font-inter)' }}
              >
                Inter
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfig({ ...config, font: 'system' })}
                className={cn(config.font === 'system' && 'border-2 border-primary')}
                style={{ fontFamily: 'system-ui' }}
              >
                System
              </Button>
            </div>
          </div>

          {/* Radius Picker */}
          <div className="space-y-2">
            <Label>Radius</Label>
            <div className="grid grid-cols-5 gap-2 max-w-sm">
              {[0, 0.3, 0.5, 0.75, 1.0].map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  onClick={() => setConfig({ ...config, radius: value })}
                  className={cn(config.radius === value && 'border-2 border-primary')}
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
