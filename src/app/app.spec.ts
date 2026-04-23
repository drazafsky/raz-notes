import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { AuthService, AuthStatus } from './auth.service';
import { AuthRecord } from './crypto.utils';
import { Note, StorageService } from './storage.service';

class MockAuthService {
  readonly status = signal<AuthStatus>('unlocked');
  readonly storedUsername = signal('Alice');
  readonly passwordlessAvailable = signal(true);
  readonly passwordlessEnrolled = signal(false);
  readonly isUnlocked = computed(() => this.status() === 'unlocked');
  readonly canUsePasswordless = computed(
    () => this.passwordlessAvailable() && this.passwordlessEnrolled()
  );

  async init(): Promise<void> {}

  async createAccount(username: string): Promise<void> {
    this.storedUsername.set(username.trim());
    this.status.set('unlocked');
  }

  async login(username: string): Promise<void> {
    this.storedUsername.set(username.trim());
    this.status.set('unlocked');
  }

  async loginWithDevice(): Promise<void> {
    this.status.set('unlocked');
  }

  async enablePasswordlessUnlock(): Promise<void> {
    this.passwordlessEnrolled.set(true);
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.passwordlessEnrolled.set(false);
  }

  logout(): void {
    this.status.set('locked');
  }
}

class MockStorageService {
  init = jasmine.createSpy('init').and.returnValue(Promise.resolve());
  setVaultKey = jasmine.createSpy('setVaultKey');
  exportVaultKey = jasmine.createSpy('exportVaultKey').and.returnValue(Promise.resolve(new ArrayBuffer(32)));
  readAuthRecord = jasmine.createSpy('readAuthRecord').and.returnValue(
    Promise.resolve<AuthRecord | null>(null)
  );
  saveAuthRecord = jasmine.createSpy('saveAuthRecord').and.returnValue(Promise.resolve());
  loadNotes = jasmine.createSpy('loadNotes').and.returnValue(Promise.resolve([] as Note[]));
  saveNotes = jasmine.createSpy('saveNotes').and.returnValue(Promise.resolve());
  writeAttachment = jasmine.createSpy('writeAttachment').and.returnValue(Promise.resolve());
  readAttachment = jasmine.createSpy('readAttachment').and.returnValue(
    Promise.resolve(new Blob(['attachment']))
  );
  deleteNote = jasmine.createSpy('deleteNote').and.returnValue(Promise.resolve());
}

describe('App', () => {
  let mockAuth: MockAuthService;
  let mockStorage: MockStorageService;

  beforeEach(async () => {
    mockAuth = new MockAuthService();
    mockStorage = new MockStorageService();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: StorageService, useValue: mockStorage }
      ]
    }).compileComponents();
  });

  it('shows local account setup when no account exists', async () => {
    mockAuth.status.set('setup-required');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Create your local account');
  });

  it('creates a plain text note and persists it when unlocked', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.noteKind = 'text';
    app.noteTitle = 'My text note';
    app.noteText = 'Remember milk';
    await app.createNote();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].kind).toBe('text');
    expect(app.notes()[0].text).toBe('Remember milk');
    expect(mockStorage.saveNotes).toHaveBeenCalled();
  });

  it('shows a device unlock button when passwordless is enabled', async () => {
    mockAuth.status.set('locked');
    mockAuth.passwordlessEnrolled.set(true);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Unlock with device');
  });

  it('loads notes after a successful device unlock', async () => {
    const savedNote: Note = {
      id: 1,
      kind: 'text',
      title: 'Saved',
      text: 'Persisted',
      createdAt: new Date().toISOString(),
      attachments: []
    };
    mockAuth.status.set('locked');
    mockAuth.passwordlessEnrolled.set(true);
    mockStorage.loadNotes.and.returnValue(Promise.resolve([savedNote]));

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await app.loginWithDevice();

    expect(app.notes()).toEqual([savedNote]);
  });

  it('formats file sizes correctly', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app.formatFileSize(500)).toBe('500 B');
    expect(app.formatFileSize(1536)).toBe('1.5 KB');
    expect(app.formatFileSize(2097152)).toBe('2.0 MB');
  });
});
