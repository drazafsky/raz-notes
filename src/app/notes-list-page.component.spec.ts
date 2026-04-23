import { computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';

import { AuthService, AuthStatus } from './auth.service';
import { NotesListPageComponent } from './notes-list-page.component';
import { NotesStateService } from './notes-state.service';
import { Note, StorageService } from './storage.service';

class MockAuthService {
  readonly status = signal<AuthStatus>('unlocked');
  readonly storedUsername = signal('Alice');
  readonly passwordlessAvailable = signal(true);
  readonly passwordlessEnrolled = signal(false);
  readonly isUnlocked = computed(() => this.status() === 'unlocked');
  readonly canUsePasswordless = computed(
    () => this.passwordlessAvailable() && this.passwordlessEnrolled(),
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
      title: 'Saved',
      elements: [{ id: 't1', text: 'Body', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T01:00:00.000Z',
      attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
    },
  ]);
  readonly notesByUpdatedAt = computed(() => this.notes());
  deleteNote = jasmine.createSpy('deleteNote').and.returnValue(Promise.resolve());
}

describe('NotesListPageComponent', () => {
  it('renders note metadata and attachments in the list', async () => {
    await TestBed.configureTestingModule({
      imports: [NotesListPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: NotesStateService, useClass: MockNotesStateService },
        {
          provide: StorageService,
          useValue: jasmine.createSpyObj<StorageService>('StorageService', {
            readAttachment: Promise.resolve(new Blob(['demo'], { type: 'text/plain' })),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotesListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Saved');
    expect(fixture.nativeElement.textContent).toContain('Last modified');
    expect(fixture.nativeElement.textContent).toContain('file.txt');
    expect(fixture.nativeElement.textContent).toContain('Delete');
  });

  it('deletes a note from the list page', async () => {
    const notesState = new MockNotesStateService();
    await TestBed.configureTestingModule({
      imports: [NotesListPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: NotesStateService, useValue: notesState },
        {
          provide: StorageService,
          useValue: jasmine.createSpyObj<StorageService>('StorageService', {
            readAttachment: Promise.resolve(new Blob(['demo'], { type: 'text/plain' })),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotesListPageComponent);
    const component = fixture.componentInstance;

    await component.deleteNote(1);

    expect(notesState.deleteNote).toHaveBeenCalledWith(1);
  });

  it('uses the same note route for the preview and Open link', async () => {
    await TestBed.configureTestingModule({
      imports: [NotesListPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: NotesStateService, useClass: MockNotesStateService },
        {
          provide: StorageService,
          useValue: jasmine.createSpyObj<StorageService>('StorageService', {
            readAttachment: Promise.resolve(new Blob(['demo'], { type: 'text/plain' })),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotesListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const previewLink = fixture.debugElement.query(
      By.css('a[aria-label="Open preview for Saved"]'),
    );
    const openLink = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .find(
        (debugElement) =>
          debugElement.nativeElement instanceof HTMLAnchorElement &&
          debugElement.nativeElement.textContent.trim() === 'Open',
      );

    expect(previewLink).withContext('Expected the note preview to be a link').not.toBeNull();
    expect(openLink).withContext('Expected the note card to keep its Open link').toBeDefined();
    expect(previewLink.nativeElement.getAttribute('href')).toBe(
      openLink?.nativeElement.getAttribute('href'),
    );
  });
});
