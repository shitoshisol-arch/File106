// A salted digest of the request address.
//
// The raw IP is never stored: it is personal data with no operational use
// beyond rate limiting and abuse review, and a digest still lets two events be
// correlated without turning a database dump into a visitor log.

import { createHash } from 'node:crypto';

export function ipHash(request) {
  return createHash('sha256')
    .update(`${request.ip}:${process.env.IP_HASH_SALT ?? 'file106-archive'}`)
    .digest('hex');
}
