import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { App } from './app';
import { AuthService, AuthStatus } from './auth.service';
import { LoginTimeoutOption } from './crypto.utils';
import { Note } from './storage.service';
import { NotesStateService } from './notes-state.service';

@Component({ template: '' })
class DummyRouteComponent {}

class MockAuthService {
  readonly status = signal<AuthStatus>('unlocked');
  readonly storedUsername = signal('Alice');
  readonly passwordlessAvailable = signal(true);
  readonly passwordlessEnrolled = signal(false);
  readonly loginTimeout = signal<LoginTimeoutOption>('1-hour');
  readonly isUnlocked = computed(() => this.status() === 'unlocked');
  readonly canUsePasswordless = computed(
    () => this.passwordlessAvailable() && this.passwordlessEnrolled(),
  );

  async init(): Promise<void> {
    return Promise.resolve();
  }
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
  async setLoginTimeout(timeout: LoginTimeoutOption): Promise<void> {
    this.loginTimeout.set(timeout);
  }
  readonly recordActivity = jasmine.createSpy('recordActivity');
  lockForUnfocus(): void {
    if (this.loginTimeout() === 'application-unfocus') {
      this.status.set('locked');
    }
  }
  logout(): void {
    this.status.set('locked');
  }
}

class MockNotesStateService {
  readonly notes = signal<Note[]>([
    {
      id: 7,
      title: 'Existing note',
      elements: [{ id: 't1', text: 'Saved body', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T01:00:00.000Z',
      attachments: [],
    },
  ]);
  readonly notesByUpdatedAt = computed(() => this.notes());
  readonly notesByTitle = computed(() => this.notes());

  load = jasmine.createSpy('load').and.returnValue(Promise.resolve());
  clear = jasmine.createSpy('clear');
  getNote(noteId: number): Note | undefined {
    return this.notes().find((note) => note.id === noteId);
  }
}

describe('App', () => {
  let mockAuth: MockAuthService;
  let mockNotesState: MockNotesStateService;

  beforeEach(async () => {
    mockAuth = new MockAuthService();
    mockNotesState = new MockNotesStateService();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'notes', component: DummyRouteComponent },
          { path: 'notes/new', component: DummyRouteComponent },
          { path: 'notes/:id', component: DummyRouteComponent },
          { path: 'settings', component: DummyRouteComponent },
        ]),
        { provide: AuthService, useValue: mockAuth },
        { provide: NotesStateService, useValue: mockNotesState },
      ],
    }).compileComponents();
  });

  it('shows local account setup when no account exists', async () => {
    mockAuth.status.set('setup-required');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Create your local account');
  });

  it('shows device unlock on the locked screen when passwordless is enabled', async () => {
    mockAuth.status.set('locked');
    mockAuth.passwordlessEnrolled.set(true);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Unlock with device');
  });

  it('loads notes after a successful login', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.loginUsername = 'Alice';
    app.loginPassword = 'password123';
    await app.login();

    expect(mockNotesState.load).toHaveBeenCalled();
    expect(mockAuth.status()).toBe('unlocked');
  });

  it('shows routed navigation when unlocked', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const mobileMenuButton = fixture.nativeElement.querySelector(
      'button[aria-label="Open navigation menu"]',
    );

    expect(mobileMenuButton).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Notes');
    expect(fixture.nativeElement.textContent).toContain('New Note');
    expect(fixture.nativeElement.textContent).toContain('Settings');
    expect(fixture.nativeElement.textContent).toContain('Existing note');
  });

  it('records user activity on keyboard interaction while unlocked', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    expect(mockAuth.recordActivity).toHaveBeenCalled();
  });

  it('collapses navigation on note editor routes until toggled open', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/notes/7');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.isNoteEditorRoute()).toBeTrue();
    expect(fixture.componentInstance.mobileMenuOpen()).toBeFalse();

    fixture.componentInstance.toggleMobileMenu();
    fixture.detectChanges();

    expect(fixture.componentInstance.mobileMenuOpen()).toBeTrue();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Close navigation menu"]'),
    ).toBeTruthy();
  });
});
