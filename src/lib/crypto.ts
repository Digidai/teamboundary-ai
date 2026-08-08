const encoder = new TextEncoder();

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    typeof value === 'string'
      ? encoder.encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}
