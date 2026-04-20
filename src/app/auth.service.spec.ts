import { TestBed } from '@angular/core/testing';

import { AuthService, DEFAULT_LOGIN_TIMEOUT } from './auth.service';
import { AuthRecord } from './crypto.utils';
import { StorageService } from './storage.service';

function createMockPublicKeyCredential(
  id: Uint8Array,
  prfOutput?: Uint8Array,
): PublicKeyCredential {
  return {
    rawId: id.buffer.slice(0),
    getClientExtensionResults: () =>
      prfOutput
        ? {
            prf: {
              enabled: true,
              results: {
                first: prfOutput.buffer.slice(0),
              },
            },
          }
        : { prf: { enabled: true } },
  } as unknown as PublicKeyCredential;
}

describe('AuthService', () => {
  let service: AuthService;
  let storage: jasmine.SpyObj<StorageService>;
  let createSpy: jasmine.Spy;
  let getSpy: jasmine.Spy;
  let originalGetClientCapabilities:
    | (() => Promise<Record<string, boolean | undefined>>)
    | undefined;

  beforeEach(() => {
    localStorage.clear();
    storage = jasmine.createSpyObj<StorageService>('StorageService', [
      'init',
      'readAuthRecord',
      'saveAuthRecord',
      'setVaultKey',
      'exportVaultKey',
      'loadNotes',
      'saveNotes',
      'writeAttachment',
      'readAttachment',
      'deleteNote',
    ]);
    storage.init.and.returnValue(Promise.resolve());
    storage.readAuthRecord.and.returnValue(Promise.resolve(null));
    storage.saveAuthRecord.and.returnValue(Promise.resolve());
    storage.exportVaultKey.and.returnValue(Promise.resolve(new Uint8Array(32).fill(9).buffer));

    createSpy = spyOn(navigator.credentials, 'create').and.returnValue(Promise.resolve(null));
    getSpy = spyOn(navigator.credentials, 'get').and.returnValue(Promise.resolve(null));
    spyOn(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable').and.returnValue(
      Promise.resolve(true),
    );
    originalGetClientCapabilities = (
      PublicKeyCredential as typeof PublicKeyCredential & {
        getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
      }
    ).getClientCapabilities;
    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      configurable: true,
      value: jasmine
        .createSpy('getClientCapabilities')
        .and.returnValue(Promise.resolve({ prf: true })),
    });

    TestBed.configureTestingModule({
      providers: [{ provide: StorageService, useValue: storage }],
    });

    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      configurable: true,
      value: originalGetClientCapabilities,
    });
  });

  it('starts in setup mode when no auth record exists', async () => {
    await service.init();

    expect(service.status()).toBe('setup-required');
    expect(service.passwordlessAvailable()).toBeTrue();
  });

  it('creates an account, persists the auth record, and unlocks the vault', async () => {
    await service.createAccount('Alice', 'password123');

    expect(storage.saveAuthRecord).toHaveBeenCalled();
    expect(service.status()).toBe('unlocked');
    expect(service.storedUsername()).toBe('Alice');
    expect(storage.setVaultKey).toHaveBeenCalled();
    expect(
      (storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord).loginSettings?.timeout,
    ).toBe(DEFAULT_LOGIN_TIMEOUT);
  });

  it('logs in with the original password after locking', async () => {
    await service.createAccount('Alice', 'password123');
    service.logout();
    storage.setVaultKey.calls.reset();

    await service.login('Alice', 'password123');

    expect(service.status()).toBe('unlocked');
    expect(storage.setVaultKey).toHaveBeenCalled();
  });

  it('enables and uses passwordless unlock when the browser supports it', async () => {
    await service.init();
    await service.createAccount('Alice', 'password123');

    const credentialId = new Uint8Array([1, 2, 3, 4]);
    const prfOutput = new Uint8Array(32).fill(7);
    createSpy.and.returnValue(Promise.resolve(createMockPublicKeyCredential(credentialId)));
    getSpy.and.returnValue(Promise.resolve(createMockPublicKeyCredential(credentialId, prfOutput)));

    await service.enablePasswordlessUnlock();
    service.logout();
    storage.setVaultKey.calls.reset();

    await service.loginWithDevice();

    expect(service.passwordlessEnrolled()).toBeTrue();
    expect(service.status()).toBe('unlocked');
    expect(createSpy).toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalled();
    expect(storage.setVaultKey).toHaveBeenCalled();
  });

  it('removes passwordless unlock from the stored auth record', async () => {
    await service.init();
    await service.createAccount('Alice', 'password123');

    const credentialId = new Uint8Array([1, 2, 3, 4]);
    const prfOutput = new Uint8Array(32).fill(7);
    createSpy.and.returnValue(Promise.resolve(createMockPublicKeyCredential(credentialId)));
    getSpy.and.returnValue(Promise.resolve(createMockPublicKeyCredential(credentialId, prfOutput)));

    await service.enablePasswordlessUnlock();
    await service.disablePasswordlessUnlock();

    expect(service.passwordlessEnrolled()).toBeFalse();
    expect(
      (storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord).passwordless,
    ).toBeUndefined();
  });

  it('loads a stored account and starts locked with passwordless state', async () => {
    await service.createAccount('Alice', 'password123');
    localStorage.clear();
    const saved = storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord;
    storage.readAuthRecord.and.returnValue(
      Promise.resolve({
        ...saved,
        passwordless: {
          version: 1,
          credentialId: 'AQIDBA==',
          prfSalt: 'AQIDBA==',
          iv: 'AQIDBA==',
          wrappedVaultKey: 'AQIDBA==',
          createdAt: new Date().toISOString(),
        },
      }),
    );

    await service.init();

    expect(service.status()).toBe('locked');
    expect(service.passwordlessEnrolled()).toBeTrue();
  });

  it('restores an unlocked session on init when the persisted session is still valid', async () => {
    await service.createAccount('Alice', 'password123');
    const saved = storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord;
    storage.readAuthRecord.and.returnValue(Promise.resolve(saved));
    storage.setVaultKey.calls.reset();

    const restoredService = TestBed.runInInjectionContext(() => new AuthService());
    await restoredService.init();

    expect(restoredService.status()).toBe('unlocked');
    expect(storage.setVaultKey).toHaveBeenCalled();
  });

  it('locks on init when the persisted session has expired', async () => {
    await service.createAccount('Alice', 'password123');
    const saved = storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord;
    storage.readAuthRecord.and.returnValue(Promise.resolve(saved));

    const sessionText = localStorage.getItem('raz-notes.session');
    expect(sessionText).not.toBeNull();
    localStorage.setItem(
      'raz-notes.session',
      JSON.stringify({
        ...JSON.parse(sessionText as string),
        lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        unlockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const restoredService = TestBed.runInInjectionContext(() => new AuthService());
    await restoredService.init();

    expect(restoredService.status()).toBe('locked');
    expect(localStorage.getItem('raz-notes.session')).toBeNull();
  });

  it('persists the selected login timeout', async () => {
    await service.createAccount('Alice', 'password123');

    await service.setLoginTimeout('never');

    expect(service.loginTimeout()).toBe('never');
    expect(
      (storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord).loginSettings?.timeout,
    ).toBe('never');
  });

  it('locks immediately on unfocus when that login timeout is configured', async () => {
    await service.createAccount('Alice', 'password123');
    await service.setLoginTimeout('application-unfocus');

    service.lockForUnfocus();

    expect(service.status()).toBe('locked');
    expect(localStorage.getItem('raz-notes.session')).toBeNull();
  });

  it('refreshes the persisted session activity timestamp when the user interacts', async () => {
    await service.createAccount('Alice', 'password123');
    await service.setLoginTimeout('30-minutes');

    const sessionText = localStorage.getItem('raz-notes.session');
    expect(sessionText).not.toBeNull();
    localStorage.setItem(
      'raz-notes.session',
      JSON.stringify({
        ...JSON.parse(sessionText as string),
        lastActivityAt: '2026-04-19T00:00:00.000Z',
      }),
    );

    service.recordActivity();

    const refreshedSession = JSON.parse(localStorage.getItem('raz-notes.session') as string) as {
      lastActivityAt: string;
    };
    expect(refreshedSession.lastActivityAt).not.toBe('2026-04-19T00:00:00.000Z');
  });
});
