import { Injectable, computed, signal } from '@angular/core';

import {
  AuthRecord,
  base64ToBytes,
  bytesToBase64,
  normalizeUsername,
  toArrayBuffer
} from './crypto.utils';
import { StorageService } from './storage.service';

export type AuthStatus = 'initializing' | 'setup-required' | 'locked' | 'unlocked';

const MIN_PASSWORD_LENGTH = 8;
const WRAP_SALT_BYTES = 16;
const WRAP_IV_BYTES = 12;
const PBKDF2_ITERATIONS = 310000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly status = signal<AuthStatus>('initializing');
  readonly storedUsername = signal('');
  readonly isUnlocked = computed(() => this.status() === 'unlocked');

  private authRecord: AuthRecord | null = null;

  constructor(private readonly storage: StorageService) {}

  async init(): Promise<void> {
    await this.storage.init();
    this.authRecord = await this.storage.readAuthRecord();
    this.storedUsername.set(this.authRecord?.username ?? '');
    this.status.set(this.authRecord ? 'locked' : 'setup-required');
  }

  async createAccount(username: string, password: string): Promise<void> {
    const trimmedUsername = username.trim();
    const normalizedUsername = normalizeUsername(username);

    if (!trimmedUsername) {
      throw new Error('Username is required.');
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }

    const vaultKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const wrapSalt = crypto.getRandomValues(new Uint8Array(WRAP_SALT_BYTES));
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
    const wrappingKey = await this.deriveWrappingKey(password, wrapSalt, PBKDF2_ITERATIONS);
    const exportedVaultKey = await crypto.subtle.exportKey('raw', vaultKey);
    const wrappedVaultKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapIv },
      wrappingKey,
      exportedVaultKey
    );

    const record: AuthRecord = {
      version: 1,
      username: trimmedUsername,
      normalizedUsername,
      salt: bytesToBase64(wrapSalt),
      iv: bytesToBase64(wrapIv),
      wrappedVaultKey: bytesToBase64(wrappedVaultKey),
      iterations: PBKDF2_ITERATIONS,
      createdAt: new Date().toISOString()
    };

    await this.storage.saveAuthRecord(record);
    this.authRecord = record;
    this.storedUsername.set(record.username);
    this.storage.setVaultKey(vaultKey);
    this.status.set('unlocked');
  }

  async login(username: string, password: string): Promise<void> {
    if (!this.authRecord) {
      throw new Error('Create a local account before signing in.');
    }

    if (normalizeUsername(username) !== this.authRecord.normalizedUsername) {
      throw new Error('Invalid username or password.');
    }

    const wrappingKey = await this.deriveWrappingKey(
      password,
      base64ToBytes(this.authRecord.salt),
      this.authRecord.iterations
    );

    let rawVaultKey: ArrayBuffer;
    try {
      rawVaultKey = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(this.authRecord.iv)) },
        wrappingKey,
        toArrayBuffer(base64ToBytes(this.authRecord.wrappedVaultKey))
      );
    } catch {
      throw new Error('Invalid username or password.');
    }

    const vaultKey = await crypto.subtle.importKey(
      'raw',
      rawVaultKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    this.storage.setVaultKey(vaultKey);
    this.status.set('unlocked');
  }

  logout(): void {
    this.storage.setVaultKey(null);
    this.status.set(this.authRecord ? 'locked' : 'setup-required');
  }

  private async deriveWrappingKey(
    password: string,
    salt: Uint8Array,
    iterations: number
  ): Promise<CryptoKey> {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: toArrayBuffer(salt),
        iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );
  }
}
