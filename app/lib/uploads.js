// Private attachment storage.
//
// Files are written outside the static tree and are only ever read back through
// an admin-authenticated route, so a storage key is not a URL. Keys are 16
// random bytes rather than anything derived from the uploaded name: a leaked
// list of one file's attachments tells an attacker nothing about any other, and
// a key can never traverse out of the directory.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const KEY = /^[a-f0-9]{32}$/;

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

export function createUploadStore({ dir, maxBytes, allowedMime }) {
  const root = resolve(dir);

  function assertKey(storageKey) {
    if (!KEY.test(String(storageKey ?? ''))) throw reject('bad_key', 'Unknown attachment.');
    return join(root, storageKey);
  }

  return {
    directory: root,

    async save({ buffer, mimeType }) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw reject('empty_upload', 'That file is empty.');
      }
      if (buffer.length > maxBytes) {
        throw reject('too_large', `That file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      }
      if (!allowedMime.includes(String(mimeType ?? ''))) {
        throw reject('bad_type', `Unsupported file type. Allowed: ${allowedMime.join(', ')}.`);
      }

      const storageKey = randomBytes(16).toString('hex');
      await mkdir(root, { recursive: true });
      await writeFile(assertKey(storageKey), buffer, { mode: 0o600 });

      return {
        storageKey,
        byteSize: buffer.length,
        checksumSha256: createHash('sha256').update(buffer).digest('hex'),
      };
    },

    async read(storageKey) {
      try {
        return await readFile(assertKey(storageKey));
      } catch (error) {
        if (error.code === 'ENOENT') throw reject('missing_upload', 'That file is no longer stored.');
        throw error;
      }
    },

    // A missing file is not an error: the row is the record, and the caller is
    // about to delete it either way.
    async remove(storageKey) {
      await rm(assertKey(storageKey), { force: true });
    },
  };
}
