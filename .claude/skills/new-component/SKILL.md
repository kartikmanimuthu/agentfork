---
name: new-component
description: Scaffold a new UI component in apps/web-ui/components/ui/ following shadcn/ui, Radix UI, and CVA patterns
---

When creating a new UI component in `apps/web-ui/components/ui/`:

## File Structure
Create a single file: `apps/web-ui/components/ui/<kebab-case-name>.tsx`

## Pattern Requirements

1. **Use `cn()` utility**
   - Import from `@/lib/utils`
   - `import { cn } from '@/lib/utils';`

2. **Use class-variance-authority (CVA) for variants**
   - Import: `import { cva, type VariantProps } from 'class-variance-authority';`
   - Define a `variants` object with `cva()` for the root element
   - Export a type for variant props: `export interface XProps extends React.ComponentPropsWithoutRef<'div'>, VariantProps<typeof xVariants> {}`

3. **Forward refs with `React.forwardRef`**
   - Always forward refs for composability
   - Set `.displayName` after the component definition

4. **Export compound components**
   - If the component has sub-parts (e.g., Dialog, DialogTrigger), export them as named exports
   - Follow the Radix UI compound component pattern

5. **Add a basic test**
   - Create `<name>.test.tsx` alongside the component
   - Use `@testing-library/react` and `vitest`
   - Test rendering and variant classes

## Example Template

```tsx
// apps/web-ui/components/ui/alert.tsx
'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 text-destructive dark:border-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface AlertProps
  extends React.ComponentPropsWithoutRef<'div'>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
);
Alert.displayName = 'Alert';

export { Alert };
```

## Test Template

```tsx
// apps/web-ui/components/ui/alert.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Alert } from './alert';

describe('Alert', () => {
  it('renders with default variant', () => {
    const { container } = render(<Alert>Hello</Alert>);
    expect(container.firstChild).toHaveClass('bg-background');
  });

  it('renders with destructive variant', () => {
    const { container } = render(<Alert variant="destructive">Error</Alert>);
    expect(container.firstChild).toHaveClass('border-destructive');
  });
});
```
