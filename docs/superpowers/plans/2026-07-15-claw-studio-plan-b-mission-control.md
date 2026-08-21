# Claw Studio — Plan B: Mission Control App Shell & Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/mission-control` — a separate Next.js app with its own Studio-credentials login (Studio ID + password) — that a user reaches from the web-ui "Mission Control" button, logs into, and lands in a console shell showing the Claw sidebar and a Mission Dashboard.

**Architecture:** A new Nx application `apps/mission-control` (mirroring `apps/web-ui`'s `nx:run-commands` + per-app `package.json` conventions), on port **3010**. It has its **own** NextAuth v4 config — a Credentials provider that authenticates `studioId`+password against `ClawStudio.passwordHash` (via a new `StudioService.authenticate`), decoupled from web-ui's user session. Middleware guards the console and injects the resolved `tenantId`. The console renders a shadcn sidebar with 6 sections; Plan B ships the Mission Dashboard for real and stubs the other five ("coming soon") — those are Plan C / later.

**Tech Stack:** Next.js 15 (App Router), NextAuth v4 (Credentials), Prisma/PostgreSQL, `bcryptjs`, T3 Env, shadcn/ui, Tailwind v3, TanStack Query, Pino.

## Global Constraints

- **Nx executor:** app `project.json` uses the `nx:run-commands` executor shelling to `bun run <script>` with `cwd` — NEVER `@nx/next` (it breaks with `next` in root devDependencies).
- **Port:** Mission Control runs on **3010** (set via `next dev -p 3010` / `next start -p 3010` in the per-app `package.json`; web-ui owns 3005, SDK owns 3007).
- **tsconfig paths:** the app tsconfig must re-declare the `@chatbot/*` aliases it uses (paths do NOT merge with the base) plus `"@/*": ["./*"]`.
- **Dependency layout:** `next`/`react`/`react-dom` are declared in BOTH root and the app `package.json` at the same ranges; `next-auth`, `@tanstack/react-query`, `@t3-oss/*`, `@prisma/client`, `bcryptjs` resolve from ROOT and are NOT re-declared in the app; UI libs (Radix, shadcn, sonner, tailwind toolchain, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`) go in the app `package.json`.
- **Separate auth:** Mission Control uses its OWN NextAuth config and its OWN `NEXTAUTH_SECRET` — it must NOT reuse `createAuthOptions()` (that is user auth). The Studio session carries `{ studioId, tenantId, clawId }`.
- **Validation:** Zod at every API/form boundary; login form validated with Zod before `signIn`.
- **Env:** all new env vars via T3 Env in `apps/mission-control/lib/env.ts`; never read `process.env` directly. `next.config.ts` imports `./lib/env` for the validation side-effect; T3 env packages listed in `transpilePackages`.
- **UI:** shadcn/ui components only.
- **Error handling / logging:** try/catch + Pino (`createLogger`) in route handlers and service methods; structured context `{ tenantId, studioId, clawId }`; client components surface errors via `sonner` toast (repo convention — no Pino in client components).
- **Datastore:** PostgreSQL only; reuse `getPrismaClient()` from `@chatbot/shared`. No new datastore.
- **Dependency isolation:** do NOT add `@copilotkit/*`/`@langchain/*`/`deepagents` in Plan B (that is Plan C).
- **No heavy web-ui config:** the MC `next.config.ts` must NOT include the fumadocs MDX wrapper or the SDK rewrite.

---

### Task 1: Scaffold the `apps/mission-control` Nx app (boots to a blank authed-less page)

**Files:**
- Create: `apps/mission-control/project.json`
- Create: `apps/mission-control/package.json`
- Create: `apps/mission-control/tsconfig.json`
- Create: `apps/mission-control/next.config.ts`
- Create: `apps/mission-control/tailwind.config.ts`
- Create: `apps/mission-control/postcss.config.js`
- Create: `apps/mission-control/lib/env.ts`
- Create: `apps/mission-control/lib/utils.ts`
- Create: `apps/mission-control/app/globals.css`
- Create: `apps/mission-control/app/providers.tsx`
- Create: `apps/mission-control/app/layout.tsx`
- Create: `apps/mission-control/app/page.tsx` (temporary redirect to `/login`)
- Modify: root `package.json` (add `mission-control` to the `typecheck` `-p` list)

**Interfaces:**
- Produces: a buildable/serveable Nx app named `mission-control` on port 3010, with `@chatbot/shared` importable, Tailwind + shadcn tokens wired, and NextAuth/QueryClient providers mounted.

- [ ] **Step 1: `project.json`**

Create `apps/mission-control/project.json`:

```json
{
  "name": "mission-control",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/mission-control",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "outputs": ["{workspaceRoot}/apps/mission-control/.next"],
      "options": {
        "command": "bun run build",
        "cwd": "apps/mission-control"
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "continuous": true,
      "options": {
        "command": "bun run dev",
        "cwd": "apps/mission-control"
      }
    }
  }
}
```

- [ ] **Step 2: `package.json`**

Create `apps/mission-control/package.json`:

```json
{
  "name": "@chatbot/mission-control",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3010",
    "build": "next build",
    "start": "next start -p 3010",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.2.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "geist": "^1.7.0",
    "lucide-react": "^1.14.0",
    "next": "^15.2.0",
    "next-themes": "^0.4.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "zod": "^4.4.2"
  }
}
```

- [ ] **Step 3: `tsconfig.json`**

Create `apps/mission-control/tsconfig.json` (re-declares the `@chatbot/*` aliases it needs + `@/*`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@chatbot/shared": ["../../libs/shared/src/index.ts"],
      "@chatbot/shared/client": ["../../libs/shared/src/client.ts"]
    },
    "isolatedModules": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: `next.config.ts`** (no fumadocs, no SDK rewrite)

Create `apps/mission-control/next.config.ts`:

```ts
import type { NextConfig } from 'next';
import './lib/env';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream'],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { workerThreads: false, cpus: 1 },
};

export default nextConfig;
```

- [ ] **Step 5: Tailwind + PostCSS + globals + utils**

Create `apps/mission-control/postcss.config.js`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Create `apps/mission-control/tailwind.config.ts` (copy web-ui's shadcn token config):

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

Create `apps/mission-control/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Create `apps/mission-control/app/globals.css` by copying `apps/web-ui/app/globals.css` verbatim (it defines the `--background`/`--foreground`/`--sidebar-*`/`--radius` CSS variables the Tailwind tokens reference). During implementation, read `apps/web-ui/app/globals.css` and write its contents into the new file. Do NOT hand-author new tokens.

- [ ] **Step 6: T3 env**

Create `apps/mission-control/lib/env.ts`:

```ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().url(),
    // Mission Control has its OWN NextAuth secret, separate from web-ui.
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 7: Providers + layout + placeholder page**

Create `apps/mission-control/app/providers.tsx`:

```tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}
```

Create `apps/mission-control/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { cn } from '@/lib/utils';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'Operate your Claw',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(geistSans.variable, geistMono.variable)}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Create `apps/mission-control/app/page.tsx` (temporary — replaced by the console dashboard in Task 3):

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

- [ ] **Step 8: Register in the root typecheck aggregate**

In the root `package.json`, add `mission-control` to the `typecheck` script's `-p` list (append `,mission-control`):

```json
"typecheck": "nx run-many -t typecheck -p shared,ai,workers,whatsapp,agent-studio,knowledge-base,@chatbot/telegram,web-ui,mission-control",
```

- [ ] **Step 9: Install + verify build/typecheck**

Run: `bun install`
Then: `bunx nx build mission-control`
Expected: a successful Next.js production build under `apps/mission-control/.next`.
Then: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 10: Verify it serves on 3010**

Run (background): `bunx nx serve mission-control` then `curl -sI http://localhost:3010/login` (the placeholder page redirects `/` → `/login`; `/login` 404s until Task 2 — a 404 or 200 both confirm the server booted on 3010). Stop the server after confirming.
Expected: an HTTP response from port 3010 (server booted).

- [ ] **Step 11: Commit**

```bash
git add apps/mission-control package.json bun.lock
git commit -m "feat(mission-control): scaffold Nx Next.js app shell on port 3010"
```

---

### Task 2: Studio authentication — `StudioService.authenticate` + Mission Control NextAuth + login page

**Files:**
- Modify: `libs/shared/src/services/studio-service.ts` (add `authenticate`)
- Modify: `libs/shared/src/services/studio-service.test.ts` (test `authenticate`)
- Modify: `libs/shared/src/index.ts` (export `StudioAuthResult` type)
- Create: `apps/mission-control/lib/auth.ts` (Studio NextAuth options)
- Create: `apps/mission-control/types/next-auth.d.ts` (session augmentation for studio fields)
- Create: `apps/mission-control/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/mission-control/middleware.ts`
- Create: `apps/mission-control/app/(auth)/login/page.tsx`
- Create: `apps/mission-control/components/ui/{button,input,label,card}.tsx` (shadcn primitives — copy from web-ui)

**Interfaces:**
- Consumes: `ClawStudio` model, `getPrismaClient`, `createLogger` from `@chatbot/shared`.
- Produces:
  - `StudioService.authenticate(studioId: string, password: string): Promise<StudioAuthResult | null>` where `StudioAuthResult = { studioRecordId: string; studioId: string; tenantId: string; clawId: string }`. Returns `null` on unknown studioId or bad password; updates `lastLoginAt` on success.
  - A Mission Control NextAuth Credentials provider (`id: 'studio'`) whose session exposes `session.studio = { studioId, tenantId, clawId }`.

- [ ] **Step 1: Write the failing test for `authenticate`**

Add to `libs/shared/src/services/studio-service.test.ts` a new describe block:

```ts
describe('StudioService.authenticate', () => {
  it('returns the studio context for a correct studioId + password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1', studioId: 'claw_abc', passwordHash, tenantId: 'tenant_1',
      status: 'active', claws: [{ id: 'claw_1' }],
    });
    db.clawStudio.update.mockResolvedValue({});
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    const result = await svc.authenticate('claw_abc', 'correct-horse');
    expect(result).toEqual({ studioRecordId: 'studio_1', studioId: 'claw_abc', tenantId: 'tenant_1', clawId: 'claw_1' });
    expect(db.clawStudio.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'studio_1' }, data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );
  });

  it('returns null for a wrong password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1', studioId: 'claw_abc', passwordHash, tenantId: 'tenant_1',
      status: 'active', claws: [{ id: 'claw_1' }],
    });
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    expect(await svc.authenticate('claw_abc', 'wrong')).toBeNull();
    expect(db.clawStudio.update).not.toHaveBeenCalled();
  });

  it('returns null for an unknown studioId', async () => {
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    expect(await svc.authenticate('nope', 'x')).toBeNull();
  });
});
```

> The `makeDb()` helper must expose `clawStudio.findFirst`/`clawStudio.update` — it already does from Plan A. `authenticate` is tenant-agnostic (looks up by the globally-unique `studioId`), so the service's `tenantId` field is unused there — construct with `''`.

- [ ] **Step 2: Run the test → confirm it fails**

Run: `cd libs/shared && bunx vitest run src/services/studio-service.test.ts -t authenticate`
Expected: FAIL — `authenticate` is not a function.

- [ ] **Step 3: Implement `authenticate`**

In `libs/shared/src/services/studio-service.ts`, add the result type near the other interfaces:

```ts
export interface StudioAuthResult {
  studioRecordId: string;
  studioId: string;
  tenantId: string;
  clawId: string;
}
```

Add the method to `StudioService` (uses `studioId` which is globally unique, so it does not filter by `this.tenantId`):

```ts
  async authenticate(studioId: string, password: string): Promise<StudioAuthResult | null> {
    const studio = (await this.db.clawStudio.findFirst({
      where: { studioId, status: 'active' },
      include: { claws: true },
    })) as
      | { id: string; studioId: string; passwordHash: string; tenantId: string; claws: { id: string }[] }
      | null;
    if (!studio) return null;

    const bcrypt = await import('bcryptjs');
    const ok = await bcrypt.compare(password, studio.passwordHash);
    if (!ok) return null;

    await this.db.clawStudio.update({ where: { id: studio.id }, data: { lastLoginAt: new Date() } });

    const claw = studio.claws[0];
    if (!claw) return null;

    return { studioRecordId: studio.id, studioId: studio.studioId, tenantId: studio.tenantId, clawId: claw.id };
  }
```

- [ ] **Step 4: Export the type**

In `libs/shared/src/index.ts`, add `StudioAuthResult` to the existing StudioService type export:

```ts
export type { ProvisionResult, StudioSummary, ResetPasswordResult, StudioAuthResult } from './services/studio-service';
```

- [ ] **Step 5: Run the tests → confirm pass**

Run: `cd libs/shared && bunx vitest run src/services/studio-service.test.ts`
Expected: PASS (all prior tests + the 3 new `authenticate` tests).

- [ ] **Step 6: Session type augmentation**

Create `apps/mission-control/types/next-auth.d.ts`:

```ts
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    studio: { studioId: string; tenantId: string; clawId: string; studioRecordId: string };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    studioId?: string;
    tenantId?: string;
    clawId?: string;
    studioRecordId?: string;
  }
}
```

Add `"types/**/*.ts"` is already covered by the tsconfig `include` (`**/*.ts`).

- [ ] **Step 7: Mission Control NextAuth options**

Create `apps/mission-control/lib/auth.ts`:

```ts
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getPrismaClient, StudioService, createLogger } from '@chatbot/shared';
import { env } from '@/lib/env';

const logger = createLogger('mission-control:auth');

export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    CredentialsProvider({
      id: 'studio',
      name: 'Studio',
      credentials: {
        studioId: { label: 'Studio ID', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.studioId || !credentials?.password) return null;
          const service = new StudioService('', getPrismaClient());
          const result = await service.authenticate(
            credentials.studioId as string,
            credentials.password as string,
          );
          if (!result) return null;
          // NextAuth requires an `id` on the returned user object.
          return { id: result.studioRecordId, ...result };
        } catch (error) {
          logger.error({ error }, 'Studio authorize failed');
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { studioId: string; tenantId: string; clawId: string; studioRecordId: string };
        token.studioId = u.studioId;
        token.tenantId = u.tenantId;
        token.clawId = u.clawId;
        token.studioRecordId = u.studioRecordId;
      }
      return token;
    },
    async session({ session, token }) {
      session.studio = {
        studioId: (token.studioId as string) ?? '',
        tenantId: (token.tenantId as string) ?? '',
        clawId: (token.clawId as string) ?? '',
        studioRecordId: (token.studioRecordId as string) ?? '',
      };
      return session;
    },
  },
};
```

- [ ] **Step 8: NextAuth route handler**

Create `apps/mission-control/app/api/auth/[...nextauth]/route.ts`:

```ts
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 9: Middleware (guard the console, allow the login + auth routes)**

Create `apps/mission-control/middleware.ts`:

```ts
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const requestHeaders = new Headers(req.headers);
    if (token?.tenantId) {
      requestHeaders.set('x-tenant-id', token.tenantId as string);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (req.nextUrl.pathname === '/login') return true;
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)'],
};
```

- [ ] **Step 10: shadcn primitives**

Copy these component files verbatim from web-ui into `apps/mission-control/components/ui/`: `button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`. During implementation, read each `apps/web-ui/components/ui/<name>.tsx` and write it to `apps/mission-control/components/ui/<name>.tsx` unchanged (they import only `@/lib/utils` `cn` + Radix, both available). Do NOT hand-rewrite them.

- [ ] **Step 11: Login page**

Create `apps/mission-control/app/(auth)/login/page.tsx`:

```tsx
'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const loginSchema = z.object({
  studioId: z.string().min(1, 'Studio ID is required'),
  password: z.string().min(1, 'Password is required'),
});

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [studioId, setStudioId] = useState(params.get('studio') ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ studioId, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signIn('studio', { studioId, password, redirect: false });
      if (res?.error) {
        toast.error('Invalid Studio ID or password');
        return;
      }
      router.push('/dashboard');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm" data-testid="login-card">
        <CardHeader>
          <CardTitle>Mission Control</CardTitle>
          <CardDescription>Sign in with your Studio ID and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="studioId">Studio ID</Label>
              <Input id="studioId" data-testid="studio-id-input" value={studioId} onChange={(e) => setStudioId(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" data-testid="password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" data-testid="login-submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

- [ ] **Step 12: Typecheck + verify login end-to-end (manual)**

Run: `cd libs/shared && bunx vitest run src/services/studio-service.test.ts` → all pass.
Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Manual: with a provisioned Studio (from web-ui `/claw-studio`), start `bunx nx serve mission-control`, open `http://localhost:3010/login?studio=<studioId>`, enter the password, and confirm it redirects to `/dashboard` (which 404s until Task 3 — a successful redirect past `/login` proves auth works). Record the observed behavior in the report.

- [ ] **Step 13: Commit**

```bash
git add libs/shared/src/services/studio-service.ts libs/shared/src/services/studio-service.test.ts libs/shared/src/index.ts apps/mission-control
git commit -m "feat(mission-control): Studio-credentials login (authenticate + NextAuth + login page)"
```

---

### Task 3: Console shell — sidebar + Mission Dashboard (+ stubbed sections)

**Files:**
- Create: `apps/mission-control/components/ui/{sidebar,separator,avatar,tooltip}.tsx` (copy from web-ui as needed by the layout)
- Create: `apps/mission-control/lib/nav-config.ts`
- Create: `apps/mission-control/components/console-sidebar.tsx`
- Create: `apps/mission-control/app/(console)/layout.tsx`
- Create: `apps/mission-control/app/(console)/dashboard/page.tsx`
- Create: `apps/mission-control/app/(console)/{chat,skills,memory,mcp,connectors}/page.tsx` (stubs)
- Create: `apps/mission-control/app/api/claw/route.ts` (GET current Claw summary for the dashboard)
- Delete/replace: `apps/mission-control/app/page.tsx` (redirect `/` → `/dashboard`)
- Test: `apps/web-ui-e2e/src/modules/claw-studio/mission-control.spec.ts` (login → dashboard) — OR a mission-control-scoped Playwright spec (see Step 7)

**Interfaces:**
- Consumes: the Studio session (`session.studio.{clawId,tenantId,studioId}`), `getPrismaClient` for the Claw lookup.
- Produces: an authed console at `/dashboard` with a 6-item sidebar; five sections render a "coming soon" stub.

- [ ] **Step 1: Copy the sidebar primitives**

Copy from web-ui into `apps/mission-control/components/ui/`: `sidebar.tsx`, `separator.tsx`, `avatar.tsx`, `tooltip.tsx` (and any file they import from `components/ui` — read imports and copy transitively; they depend only on Radix + `@/lib/utils`). Read each source file and write it unchanged.

- [ ] **Step 2: Nav config**

Create `apps/mission-control/lib/nav-config.ts`:

```ts
import { LayoutDashboard, MessageSquare, Sparkles, Brain, Server, Plug, type LucideIcon } from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
}

export const consoleNav: NavItem[] = [
  { name: 'Mission Dashboard', href: '/dashboard', icon: LayoutDashboard, enabled: true },
  { name: 'Chat with Claw', href: '/chat', icon: MessageSquare, enabled: false },
  { name: 'Skills Runtimes', href: '/skills', icon: Sparkles, enabled: false },
  { name: 'Memory Runtimes', href: '/memory', icon: Brain, enabled: false },
  { name: 'MCP Configuration', href: '/mcp', icon: Server, enabled: false },
  { name: 'Connectors', href: '/connectors', icon: Plug, enabled: false },
];
```

- [ ] **Step 3: Sidebar component**

Create `apps/mission-control/components/console-sidebar.tsx`:

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter,
} from '@/components/ui/sidebar';
import { consoleNav } from '@/lib/nav-config';

export function ConsoleSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold">Mission Control</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Claw</SidebarGroupLabel>
          <SidebarMenu>
            {consoleNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={item.enabled ? item.name : `${item.name} (coming soon)`}
                    onClick={() => router.push(item.href)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.name}</span>
                    {!item.enabled && <span className="ml-auto text-xs text-muted-foreground">soon</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
```

> If web-ui's `sidebar.tsx` requires a `SidebarProvider`/`SidebarInset`/`SidebarTrigger`, include those in the layout (Step 4) exactly as web-ui composes them (read `apps/web-ui/components/layout/app-sidebar.tsx`'s consumer — the dashboard layout — for the exact wrapper usage and copy that composition).

- [ ] **Step 4: Console layout (server component; enforces auth)**

Create `apps/mission-control/app/(console)/layout.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { ConsoleSidebar } from '@/components/console-sidebar';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.clawId) {
    redirect('/login');
  }
  return (
    <SidebarProvider>
      <ConsoleSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm text-muted-foreground">Studio: {session.studio.studioId}</span>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

> Match the exact `SidebarProvider`/`SidebarInset`/`SidebarTrigger` export names to what web-ui's `components/ui/sidebar.tsx` provides (verify during implementation; adjust the import if the names differ).

- [ ] **Step 5: Claw summary API + Mission Dashboard**

Create `apps/mission-control/app/api/claw/route.ts`:

```ts
import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:claw');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.clawId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const db = getPrismaClient();
    const claw = await db.claw.findFirst({
      where: { id: session.studio.clawId },
      select: { id: true, name: true, autoApprove: true, createdAt: true },
    });
    return new Response(JSON.stringify({ claw, studioId: session.studio.studioId }), { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch Claw summary');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

Create `apps/mission-control/app/(console)/dashboard/page.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const db = getPrismaClient();
  const claw = session?.studio?.clawId
    ? await db.claw.findFirst({ where: { id: session.studio.clawId }, select: { name: true, autoApprove: true, createdAt: true } })
    : null;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6" data-testid="mission-dashboard">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Mission Dashboard</h2>
        <p className="text-muted-foreground">Your Claw at a glance.</p>
      </div>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{claw?.name ?? 'Claw'}</CardTitle>
          <CardDescription>Autonomous teammate</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <div>Auto-approve: {claw?.autoApprove ? 'on' : 'off'}</div>
          <div>Chat, skills, memory, MCP and connectors arrive in the next phase.</div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Stub the five other sections + fix the root redirect**

Create each of `apps/mission-control/app/(console)/{chat,skills,memory,mcp,connectors}/page.tsx` with a coming-soon stub. Example for `chat` (repeat for each, changing the title):

```tsx
export default function ChatPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <h2 className="text-3xl font-bold tracking-tight">Chat with Claw</h2>
      <p className="text-muted-foreground">Coming soon.</p>
    </div>
  );
}
```

Replace `apps/mission-control/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

- [ ] **Step 7: e2e — login → dashboard**

The e2e suite lives in `apps/web-ui-e2e` and targets web-ui (port 3005). Mission Control runs on 3010, so a Mission Control e2e needs its own Playwright target or a cross-app navigation. For Plan B, add a **mission-control-scoped** spec that drives the login form directly against port 3010.

During implementation, first check whether `apps/web-ui-e2e/playwright.config.ts` can target a second baseURL/port or whether a separate `apps/mission-control-e2e` project is warranted. The lowest-friction option: add `apps/mission-control-e2e/` mirroring the web-ui-e2e setup (its own `playwright.config.ts` with `baseURL: http://localhost:3010`, a `webServer` that runs `bunx nx serve mission-control`, and reuse the `seedTestTenant` helper pattern from Plan A's e2e). Because the Studio session is minted by real login (not a pre-minted cookie), the spec must first provision a Studio: it can call the web-ui provision API, OR seed a `ClawStudio` row directly in setup.

Given that decision has real branches, treat this step as: implement the spec that (a) seeds a tenant + a `ClawStudio` with a known password (idempotent, via the `node -e '@prisma/client'` pattern), (b) visits `http://localhost:3010/login?studio=<studioId>`, (c) fills the password and submits, (d) asserts `mission-dashboard` is visible. If standing up a second Playwright project proves to exceed a single task's scope, STOP and report it as DONE_WITH_CONCERNS with a working manual-verification transcript instead, and we will split the e2e into its own task.

Selectors the spec relies on (must match the pages): `login-card`, `studio-id-input`, `password-input`, `login-submit`, `mission-dashboard`.

- [ ] **Step 8: Typecheck + build + verify**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Run: `bunx nx build mission-control` → success.
Verify (manual or e2e per Step 7): login with a provisioned Studio → lands on `/dashboard` showing the Mission Dashboard card and the 6-item sidebar (5 marked "soon").

- [ ] **Step 9: Commit**

```bash
git add apps/mission-control apps/mission-control-e2e
git commit -m "feat(mission-control): console shell, sidebar, and Mission Dashboard"
```

---

## Self-Review

**Spec coverage:**
- §3 separate app + own login → Tasks 1–2 (`apps/mission-control`, Studio Credentials NextAuth). ✓
- §5.2 MC login authenticates Studio ID + password via `bcrypt.compare` against `ClawStudio.passwordHash`, updates `lastLoginAt`, session carries `{ studioId, tenantId, clawId }` → Task 2. ✓
- §6 console sidebar with the 6 sections; Mission Dashboard real, others stubbed → Task 3. ✓
- §10 standards (Zod on the login form + API, T3 env, shadcn only, try/catch + Pino in `authorize`/routes, no direct `process.env`) → enforced across tasks. ✓
- Constraint: heavy deps (CopilotKit/LangChain) NOT added → correct; those are Plan C. ✓
- Deferred to Plan C: Chat-with-Claw runtime, Skills/Memory/MCP/Connectors managers, the `libs/claw-studio` runtime + its `CLAUDE.md`.

**Deviations / decisions (intentional, noted):**
- MC defines its NextAuth config **inline** (`apps/mission-control/lib/auth.ts`) rather than adding a `createStudioAuthOptions` to `libs/shared`, keeping Studio auth self-contained in the app that uses it. If a second consumer ever needs it, promote it to `libs/shared` then.
- The MC e2e (Task 3, Step 7) may become its own `apps/mission-control-e2e` Playwright project; the step allows splitting it into a dedicated task if it exceeds one task's scope.
- The module `CLAUDE.md` (spec §9) is still deferred to Plan C, where `libs/claw-studio` is created — a note-to-self file could optionally be added at `apps/mission-control/CLAUDE.md` here, but the full module doc belongs with the runtime lib.

**Placeholder scan:** none — every code step has complete code; copy-from-web-ui steps name the exact source files to read and forbid hand-rewrites.

**Type consistency:** `StudioAuthResult` shape (`studioRecordId`/`studioId`/`tenantId`/`clawId`) is identical across `authenticate` (Task 2 Step 3), the NextAuth `authorize`/callbacks (Task 2 Step 7), and the session augmentation (Task 2 Step 6). `session.studio.clawId` is read consistently in the console layout, dashboard, and `/api/claw` (Task 3). Sidebar `data-testid`s / login selectors match between the pages and the e2e spec.

---

## Next plan (not in this document)

- **Plan C — Claw runtime & chat:** create `libs/claw-studio` (the LangGraph executor-graph ported from `nucleus-cloud-ops`, memory/skills/MCP, model-factory bridged to `LlmProvider`), the module `CLAUDE.md`, the CopilotKit runtime + Chat-with-Claw UI (the de-risking spike first), and wire the `/chat` section. Reference extraction already captured for authoring.
