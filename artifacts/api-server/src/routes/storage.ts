import {
  DiscardUploadBody,
  DiscardUploadResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      if (!['image/jpeg', 'image/png'].includes(contentType) || size > 10 * 1024 * 1024) {
        res.status(400).json({ error: 'Only JPEG/PNG files up to 10MB are allowed' });
        return;
      }

      const { uploadURL, objectPath } =
        await objectStorageService.getObjectEntityUploadURL();

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

router.post(
  '/storage/uploads/discard',
  async (req: Request, res: Response) => {
    const parsed = DiscardUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid temporary object path is required' });
      return;
    }

    try {
      await objectStorageService.deleteObject(parsed.data.objectPath);
      res.json(DiscardUploadResponse.parse({ success: true }));
    } catch (error) {
      req.log.error({ err: error }, 'Error discarding temporary upload');
      res.status(500).json({ error: 'Failed to discard upload' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Redirects to a short-lived signed Supabase Storage URL for the requested
 * object. Add ?download=1 to force a file download instead of inline view.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const forceDownload = req.query.download === '1';
    const filename = forceDownload
      ? (wildcardPath.split('/').pop() || 'download').replace(/[^a-zA-Z0-9._-]/g, '_')
      : undefined;

    const signedUrl = await objectStorageService.getSignedDownloadUrl(objectPath, {
      download: forceDownload ? filename : undefined,
    });

    res.redirect(signedUrl);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
