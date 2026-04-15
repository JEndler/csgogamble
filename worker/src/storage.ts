import type { PersistedArtifactResult } from './types';

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function putTextArtifact(
  bucket: R2Bucket | undefined,
  key: string,
  body: string,
  contentType: string,
): Promise<PersistedArtifactResult | null> {
  if (!bucket) return null;

  const checksum = await sha256Hex(body);
  await bucket.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { checksumSha256: checksum },
  });

  return {
    key,
    size: new TextEncoder().encode(body).byteLength,
    sha256: checksum,
  };
}

export function htmlStorageKey(matchId: number): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `raw-html/${year}/${month}/${day}/${matchId}_${timestamp}.html`;
}

export function demoStorageKey(matchId: number, sourceUrl: string): string {
  const fileName = sourceUrl.split('/').pop() || `${matchId}.dem`;
  return `demos/${matchId}/${fileName}`;
}
