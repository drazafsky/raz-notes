import { Injectable, computed, signal } from '@angular/core';

import {
  AuthRecord,
  PasswordlessCredentialRecord,
  base64ToBytes,
  bytesToBase64,
  normalizeUsername,
  toArrayBuffer
} from './crypto.utils';
import { StorageService } from './storage.service';

export type AuthStatus = 'initializing' | 'setup-required' | 'locked' | 'unlocked';

type PublicKeyCredentialConstructorWithCapabilities = typeof PublicKeyCredential & {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
};

const MIN_PASSWORD_LENGTH = 8;
const WRAP_SALT_BYTES = 16;
const WRAP_IV_BYTES = 12;
const PRF_SALT_BYTES = 32;
const USER_HANDLE_BYTES = 32;
const PBKDF2_ITERATIONS = 310000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly status = signal<AuthStatus>('initializing');
  readonly storedUsername = signal('');
  readonly passwordlessAvailable = signal(false);
  readonly passwordlessEnrolled = signal(false);
  readonly isUnlocked = computed(() => this.status() === 'unlocked');
  readonly canUsePasswordless = computed(
    () => this.passwordlessAvailable() && this.passwordlessEnrolled()
  );

  private authRecord: AuthRecord | null = null;

  constructor(private readonly storage: StorageService) {}

  async init(): Promise<void> {
    await this.storage.init();
    this.passwordlessAvailable.set(await this.detectPasswordlessAvailability());
    this.authRecord = await this.storage.readAuthRecord();
    this.storedUsername.set(this.authRecord?.username ?? '');
    this.passwordlessEnrolled.set(!!this.authRecord?.passwordless);
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
    const wrapSalt = this.randomBytes(WRAP_SALT_BYTES);
    const wrapIv = this.randomBytes(WRAP_IV_BYTES);
    const wrappingKey = await this.derivePasswordWrappingKey(
      password,
      wrapSalt,
      PBKDF2_ITERATIONS
    );
    const exportedVaultKey = await crypto.subtle.exportKey('raw', vaultKey);
    const wrappedVaultKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(wrapIv) },
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
      createdAt: new Date().toISOString(),
      userHandle: bytesToBase64(this.randomBytes(USER_HANDLE_BYTES))
    };

    await this.persistAuthRecord(record);
    this.storage.setVaultKey(vaultKey);
    this.status.set('unlocked');
  }

  async login(username: string, password: string): Promise<void> {
    const authRecord = this.requireAuthRecord();

    if (normalizeUsername(username) !== authRecord.normalizedUsername) {
      throw new Error('Invalid username or password.');
    }

    const wrappingKey = await this.derivePasswordWrappingKey(
      password,
      base64ToBytes(authRecord.salt),
      authRecord.iterations
    );

    let rawVaultKey: ArrayBuffer;
    try {
      rawVaultKey = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(authRecord.iv)) },
        wrappingKey,
        toArrayBuffer(base64ToBytes(authRecord.wrappedVaultKey))
      );
    } catch {
      throw new Error('Invalid username or password.');
    }

    this.storage.setVaultKey(await this.importVaultKey(rawVaultKey));
    this.status.set('unlocked');
  }

  async loginWithDevice(): Promise<void> {
    const passwordless = this.requirePasswordlessRecord();
    if (!this.passwordlessAvailable()) {
      throw new Error('Device unlock is not available in this browser.');
    }

    const rawVaultKey = await this.unwrapVaultKeyWithDevice(passwordless);
    this.storage.setVaultKey(await this.importVaultKey(rawVaultKey));
    this.status.set('unlocked');
  }

  async enablePasswordlessUnlock(): Promise<void> {
    const authRecord = this.requireAuthRecord();
    if (!this.isUnlocked()) {
      throw new Error('Unlock your notes with the password before enabling device unlock.');
    }
    if (!this.passwordlessAvailable()) {
      throw new Error('Device unlock is not available in this browser.');
    }

    const credentialId = await this.registerDeviceCredential(authRecord);
    const prfSalt = this.randomBytes(PRF_SALT_BYTES);
    const prfOutput = await this.requestPrfOutput(credentialId, prfSalt);
    const wrappingKey = await this.deriveDeviceWrappingKey(prfOutput);
    const wrapIv = this.randomBytes(WRAP_IV_BYTES);
    const rawVaultKey = await this.storage.exportVaultKey();
    const wrappedVaultKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(wrapIv) },
      wrappingKey,
      rawVaultKey
    );

    await this.persistAuthRecord({
      ...authRecord,
      userHandle: authRecord.userHandle ?? bytesToBase64(this.randomBytes(USER_HANDLE_BYTES)),
      passwordless: {
        version: 1,
        credentialId: bytesToBase64(credentialId),
        prfSalt: bytesToBase64(prfSalt),
        iv: bytesToBase64(wrapIv),
        wrappedVaultKey: bytesToBase64(wrappedVaultKey),
        createdAt: new Date().toISOString()
      }
    });
  }

  async disablePasswordlessUnlock(): Promise<void> {
    const authRecord = this.requireAuthRecord();
    if (!authRecord.passwordless) {
      return;
    }

    const { passwordless: _passwordless, ...rest } = authRecord;
    await this.persistAuthRecord(rest);
  }

  logout(): void {
    this.storage.setVaultKey(null);
    this.status.set(this.authRecord ? 'locked' : 'setup-required');
  }

  private async persistAuthRecord(record: AuthRecord): Promise<void> {
    await this.storage.saveAuthRecord(record);
    this.authRecord = record;
    this.storedUsername.set(record.username);
    this.passwordlessEnrolled.set(!!record.passwordless);
  }

  private requireAuthRecord(): AuthRecord {
    if (!this.authRecord) {
      throw new Error('Create a local account before signing in.');
    }

    return this.authRecord;
  }

  private requirePasswordlessRecord(): PasswordlessCredentialRecord {
    const authRecord = this.requireAuthRecord();
    if (!authRecord.passwordless) {
      throw new Error('Device unlock has not been enabled for this account.');
    }

    return authRecord.passwordless;
  }

  private async detectPasswordlessAvailability(): Promise<boolean> {
    const publicKeyCredential = this.getPublicKeyCredentialConstructor();
    if (
      !publicKeyCredential ||
      !navigator.credentials ||
      typeof navigator.credentials.create !== 'function' ||
      typeof navigator.credentials.get !== 'function' ||
      typeof publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
    ) {
      return false;
    }

    try {
      if (!(await publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) {
        return false;
      }

      if (typeof publicKeyCredential.getClientCapabilities !== 'function') {
        return false;
      }

      const capabilities = await publicKeyCredential.getClientCapabilities();
      return capabilities['prf'] === true;
    } catch {
      return false;
    }
  }

  private getPublicKeyCredentialConstructor(): PublicKeyCredentialConstructorWithCapabilities | null {
    if (typeof globalThis.PublicKeyCredential === 'undefined') {
      return null;
    }

    return globalThis.PublicKeyCredential as PublicKeyCredentialConstructorWithCapabilities;
  }

  private async registerDeviceCredential(authRecord: AuthRecord): Promise<Uint8Array> {
    const userHandle = authRecord.userHandle
      ? base64ToBytes(authRecord.userHandle)
      : this.randomBytes(USER_HANDLE_BYTES);
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: toArrayBuffer(this.randomBytes(PRF_SALT_BYTES)),
        rp: {
          id: this.getRpId(),
          name: 'Raz Notes'
        },
        user: {
          id: toArrayBuffer(userHandle),
          name: authRecord.username,
          displayName: authRecord.username
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        attestation: 'none',
        timeout: 60000,
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required'
        }
      }
    });

    const publicKeyCredential = this.requirePublicKeyCredential(
      credential,
      'Device unlock setup was cancelled.'
    );
    return new Uint8Array(publicKeyCredential.rawId);
  }

  private async unwrapVaultKeyWithDevice(
    passwordless: PasswordlessCredentialRecord
  ): Promise<ArrayBuffer> {
    const prfOutput = await this.requestPrfOutput(
      base64ToBytes(passwordless.credentialId),
      base64ToBytes(passwordless.prfSalt)
    );
    const wrappingKey = await this.deriveDeviceWrappingKey(prfOutput);

    try {
      return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(passwordless.iv)) },
        wrappingKey,
        toArrayBuffer(base64ToBytes(passwordless.wrappedVaultKey))
      );
    } catch {
      throw new Error('Device unlock failed. Use your password instead.');
    }
  }

  private async requestPrfOutput(credentialId: Uint8Array, prfSalt: Uint8Array): Promise<ArrayBuffer> {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: toArrayBuffer(this.randomBytes(PRF_SALT_BYTES)),
        rpId: this.getRpId(),
        allowCredentials: [
          {
            id: toArrayBuffer(credentialId),
            type: 'public-key'
          }
        ],
        userVerification: 'required',
        timeout: 60000,
        extensions: {
          prf: {
            eval: {
              first: toArrayBuffer(prfSalt)
            }
          }
        }
      }
    });

    const publicKeyCredential = this.requirePublicKeyCredential(
      credential,
      'Device unlock was cancelled.'
    );
    const prfOutput = publicKeyCredential.getClientExtensionResults().prf?.results?.first;
    if (!prfOutput) {
      throw new Error('This device cannot unlock the vault without your password.');
    }

    return toArrayBuffer(prfOutput);
  }

  private requirePublicKeyCredential(
    credential: Credential | null,
    fallbackMessage: string
  ): PublicKeyCredential {
    if (!credential || !('rawId' in credential)) {
      throw new Error(fallbackMessage);
    }

    return credential as PublicKeyCredential;
  }

  private async derivePasswordWrappingKey(
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

  private async deriveDeviceWrappingKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest('SHA-256', prfOutput);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt'
    ]);
  }

  private async importVaultKey(rawVaultKey: ArrayBuffer): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      rawVaultKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }

  private randomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  private getRpId(): string {
    return globalThis.location?.hostname || 'localhost';
  }
}
