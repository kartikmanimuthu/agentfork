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
