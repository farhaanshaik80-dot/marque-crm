import { GetCurrentAuthUserResponse } from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Auth used to go through Replit's login (OIDC), which only works inside
// Replit. This app is single-user now, so /auth/user just always reports
// the one owner (set in authMiddleware). /login and /logout are kept as
// harmless redirects so any old links or cached frontend code don't break.
router.get('/auth/user', (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get('/login', (_req: Request, res: Response) => {
  res.redirect('/');
});

router.get('/logout', (_req: Request, res: Response) => {
  res.redirect('/');
});

export default router;
