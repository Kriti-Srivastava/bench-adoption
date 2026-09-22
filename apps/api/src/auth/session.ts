import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@bench/shared';
import type { Config } from '../config.ts';
import { forbidden, unauthorized } from '../errors.ts';
import type { UserRow } from '../repositories/users.ts';
import type { AuthService } from '../services/auth.ts';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, or null for anonymous requests. */
    user: UserRow | null;
  }
}

/** Resolves the session cookie to `request.user` on every request. */
export function registerSessionAuth(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? ((await auth.userForSession(token)) ?? null) : null;
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  config: Config,
  token: string,
  expires: Date,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** The signed-in user; throws 401 otherwise. */
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

const rank: Record<Role, number> = { adopter: 0, staff: 1, admin: 2 };

/** preHandler allowing only users with at least the given role. */
export function requireRole(minimum: Role) {
  return async (req: FastifyRequest) => {
    const user = requireUser(req);
    if (rank[user.role] < rank[minimum]) throw forbidden();
  };
}
