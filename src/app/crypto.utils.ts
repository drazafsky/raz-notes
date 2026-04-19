export interface EncryptedPayload {
  version: 1;
  iv: string;
  ciphertext: string;
}

export interface AuthRecord {
  version: 1;
  username: string;
  normalizedUsername: string;
  salt: string;
  iv: string;
  wrappedVaultKey: string;
  iterations: number;
  createdAt: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
type BinarySource = ArrayBuffer | ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function utf8ToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToUtf8(value: BinarySource): string {
  return textDecoder.decode(toArrayBuffer(value));
}

export function bytesToBase64(value: BinarySource): string {
  const bytes = new Uint8Array(toArrayBuffer(value));
  let binary = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function toArrayBuffer(value: BinarySource): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value).slice().buffer;
  }

  const view = value as ArrayBufferView<ArrayBufferLike>;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}
