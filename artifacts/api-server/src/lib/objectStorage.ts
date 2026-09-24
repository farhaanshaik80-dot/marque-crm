import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'marque-objects';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use object storage.',
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let bucketEnsured = false;

/**
 * Creates the storage bucket on first use if it doesn't already exist.
 * Safe to call repeatedly - it's a no-op once the bucket exists.
 */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  }
  bucketEnsured = true;
}

function storageApi() {
  return supabaseAdmin.storage.from(BUCKET);
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Replaces the old Replit Object Storage service with one backed by
 * Supabase Storage. All objects live in a single private bucket; access
 * is controlled entirely by short-lived signed URLs, since this app is
 * single-user and doesn't need per-object ACL policies anymore.
 */
export class ObjectStorageService {
  /**
   * Creates a fresh object id and returns a signed URL the browser can
   * PUT the file bytes to directly, plus the internal /objects/... path
   * we store in the database to reference this file later.
   */
  async getObjectEntityUploadURL(): Promise<{
    uploadURL: string;
    objectPath: string;
  }> {
    await ensureBucket();

    const objectId = randomUUID();
    const objectName = `uploads/${objectId}`;

    const { data, error } = await storageApi().createSignedUploadUrl(
      objectName,
    );
    if (error || !data) {
      throw new Error(
        `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    return {
      uploadURL: data.signedUrl,
      objectPath: `/objects/${objectName}`,
    };
  }

  /**
   * Given our internal "/objects/..." path, returns a short-lived signed
   * URL the browser can use to view or download the file.
   */
  async getSignedDownloadUrl(
    objectPath: string,
    options: { download?: string | boolean; ttlSec?: number } = {},
  ): Promise<string> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }
    const objectName = objectPath.slice('/objects/'.length);

    const { data, error } = await storageApi().createSignedUrl(
      objectName,
      options.ttlSec ?? 3600,
      options.download !== undefined ? { download: options.download } : undefined,
    );
    if (error || !data) {
      throw new ObjectNotFoundError();
    }
    return data.signedUrl;
  }

  /** Downloads an object's raw bytes (used to send images to Gemini for OCR). */
  async downloadObjectBytes(objectPath: string): Promise<Buffer> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }
    const objectName = objectPath.slice('/objects/'.length);

    const { data, error } = await storageApi().download(objectName);
    if (error || !data) {
      throw new ObjectNotFoundError();
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /** Deletes an object by its internal "/objects/..." path. No-op if missing. */
  async deleteObject(objectPath: string): Promise<void> {
    if (!objectPath.startsWith('/objects/')) return;
    const objectName = objectPath.slice('/objects/'.length);
    await storageApi().remove([objectName]);
  }

  /**
   * Historically finalized per-object ACL metadata (owner + visibility) on
   * Replit's object storage. This app is single-user now, so there's
   * nothing to finalize - the bucket is private and every object is only
   * reachable via a signed URL minted by this server. Kept as a no-op for
   * call-site compatibility.
   */
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: { owner: string; visibility: 'public' | 'private' },
  ): Promise<string> {
    return rawPath;
  }
}
