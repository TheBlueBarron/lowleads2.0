import '@fastify/jwt';
import type { FastifySchema as BaseFastifySchema } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      companyId: string;
      role: 'company_owner' | 'technician';
      mfaVerified: boolean;
    };
    user: {
      sub: string;
      companyId: string;
      role: 'company_owner' | 'technician';
      mfaVerified: boolean;
    };
  }
}

declare module 'fastify' {
  interface FastifySchema extends BaseFastifySchema {
    tags?: string[];
    summary?: string;
    description?: string;
    security?: Array<Record<string, string[]>>;
  }
}
