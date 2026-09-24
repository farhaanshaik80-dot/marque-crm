import type { AuthUser } from '@workspace/api-zod';
import { type NextFunction, type Request, type Response } from 'express';

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

// This app is single-user (just the concierge owner), so there's no real
// login system anymore - the old version required signing in with a
// Replit account, which only works inside Replit. Every request is now
// treated as the one owner. The app's own URL is what keeps it private.
const OWNER_USER: AuthUser = {
  id: 'owner',
  email: process.env.OWNER_EMAIL ?? 'owner@marque.local',
  firstName: 'Farhan',
  lastName: null,
  profileImageUrl: null,
};

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return true;
  } as Request['isAuthenticated'];
  req.user = OWNER_USER;
  next();
}
