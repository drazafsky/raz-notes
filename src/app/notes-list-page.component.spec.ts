import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService, AuthStatus } from './auth.service';
import { NotesListPageComponent } from './notes-list-page.component';
import { NotesStateService } from './notes-state.service';
import { Note } from './storage.service';

class MockAuthService {
  readonly status = signal<AuthStatus>('unlocked');
  readonly storedUsername = signal('Alice');
  readonly passwordlessAvailable = signal(true);
  readonly passwordlessEnrolled = signal(false);
  readonly isUnlocked = computed(() => this.status() === 'unlocked');
  readonly canUsePasswordless = computed(
    () => this.passwordlessAvailable() && this.passwordlessEnrolled()
  );

  async enablePasswordlessUnlock(): Promise<void> {
    this.passwordlessEnrolled.set(true);
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.passwordlessEnrolled.set(false);
  }
}

class MockNotesStateService {
  readonly notes = signal<Note[]>([
    {
      id: 1,
      kind: 'text',
      title: 'Saved',
      text: 'Body',
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T01:00:00.000Z',
      attachments: []
    }
  ]);
  readonly notesByUpdatedAt = computed(() => this.notes());
}

describe('NotesListPageComponent', () => {
  it('renders note metadata in the list', async () => {
    await TestBed.configureTestingModule({
      imports: [NotesListPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: NotesStateService, useClass: MockNotesStateService }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(NotesListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Saved');
    expect(fixture.nativeElement.textContent).toContain('text');
    expect(fixture.nativeElement.textContent).toContain('Last modified');
  });
});
