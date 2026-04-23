import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { AuthRecord } from './crypto.utils';
import { StorageService } from './storage.service';

describe('AuthService', () => {
  let service: AuthService;
  let storage: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', [
      'init',
      'readAuthRecord',
      'saveAuthRecord',
      'setVaultKey',
      'loadNotes',
      'saveNotes',
      'writeAttachment',
      'readAttachment',
      'deleteNote'
    ]);
    storage.init.and.returnValue(Promise.resolve());
    storage.readAuthRecord.and.returnValue(Promise.resolve(null));
    storage.saveAuthRecord.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [{ provide: StorageService, useValue: storage }]
    });

    service = TestBed.inject(AuthService);
  });

  it('starts in setup mode when no auth record exists', async () => {
    await service.init();

    expect(service.status()).toBe('setup-required');
    expect(service.storedUsername()).toBe('');
  });

  it('creates an account, persists the auth record, and unlocks the vault', async () => {
    await service.createAccount('Alice', 'password123');

    expect(storage.saveAuthRecord).toHaveBeenCalled();
    expect(service.status()).toBe('unlocked');
    expect(service.storedUsername()).toBe('Alice');
    expect(storage.setVaultKey).toHaveBeenCalled();
  });

  it('logs in with the original password after locking', async () => {
    await service.createAccount('Alice', 'password123');
    service.logout();
    storage.setVaultKey.calls.reset();

    await service.login('Alice', 'password123');

    expect(service.status()).toBe('unlocked');
    expect(storage.setVaultKey).toHaveBeenCalled();
  });

  it('rejects an invalid password', async () => {
    await service.createAccount('Alice', 'password123');
    service.logout();

    await expectAsync(service.login('Alice', 'wrong-password')).toBeRejectedWithError(
      'Invalid username or password.'
    );
  });

  it('loads a stored account and starts locked', async () => {
    await service.createAccount('Alice', 'password123');
    service.logout();
    storage.readAuthRecord.and.returnValue(
      Promise.resolve(storage.saveAuthRecord.calls.mostRecent().args[0] as AuthRecord)
    );

    await service.init();

    expect(service.status()).toBe('locked');
    expect(service.storedUsername()).toBe('Alice');
  });
});
