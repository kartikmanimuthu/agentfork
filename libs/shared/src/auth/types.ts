import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      tenantId?: string | null;
      role?: string | null;
      isSuperAdmin?: boolean;
    };
  }

  interface User {
    id: string;
    email: string;
    isSuperAdmin?: boolean;
    activeTenantId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string | null;
    role?: string | null;
    isSuperAdmin?: boolean;
  }
}
