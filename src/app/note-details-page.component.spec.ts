import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';

import { NoteDetailsPageComponent } from './note-details-page.component';
import { NotesStateService } from './notes-state.service';
import { Note, StorageService } from './storage.service';

class MockNotesStateService {
  note: Note = {
    id: 7,
    kind: 'text',
    title: 'Existing note',
    text: 'Saved body',
    createdAt: '2026-04-19T00:00:00.000Z',
    lastModifiedAt: '2026-04-19T00:00:00.000Z',
    attachments: []
  };

  getNote(noteId: number): Note | undefined {
    return noteId === this.note.id ? this.note : undefined;
  }

  updateNote = jasmine.createSpy('updateNote').and.callFake(async (_noteId: number, input: { title: string }) => ({
    ...this.note,
    title: input.title,
    lastModifiedAt: '2026-04-19T02:00:00.000Z'
  }));

  createNote = jasmine.createSpy('createNote');
  deleteNote = jasmine.createSpy('deleteNote').and.returnValue(Promise.resolve());
}

describe('NoteDetailsPageComponent', () => {
  it('prepopulates the selected note', async () => {
    const notesState = new MockNotesStateService();
    await TestBed.configureTestingModule({
      imports: [NoteDetailsPageComponent],
      providers: [
        provideRouter([]),
        { provide: NotesStateService, useValue: notesState },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) => (key === 'id' ? '7' : null)
              }
            }
          }
        },
        { provide: StorageService, useValue: jasmine.createSpyObj<StorageService>('StorageService', ['readAttachment']) }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(NoteDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.noteTitle).toBe('Existing note');
    expect(fixture.componentInstance.noteText).toBe('Saved body');
  });
});
