import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { App } from './app';
import { Note, StorageService } from './storage.service';

describe('App', () => {
  let mockStorage: jasmine.SpyObj<StorageService>;

  beforeEach(async () => {
    mockStorage = jasmine.createSpyObj<StorageService>('StorageService', [
      'init',
      'saveIndex',
      'writeAttachment',
      'readAttachment',
      'deleteNote'
    ]);
    mockStorage.init.and.returnValue(Promise.resolve([]));
    mockStorage.saveIndex.and.returnValue(Promise.resolve());
    mockStorage.writeAttachment.and.returnValue(Promise.resolve());
    mockStorage.deleteNote.and.returnValue(Promise.resolve());

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: StorageService, useValue: mockStorage }]
    }).compileComponents();
  });

  it('should create the app', fakeAsync(() => {
    const fixture = TestBed.createComponent(App);
    flushMicrotasks();
    expect(fixture.componentInstance).toBeTruthy();
  }));

  it('should create a plain text note and persist it', fakeAsync(() => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    flushMicrotasks();

    app.noteKind = 'text';
    app.noteTitle = 'My text note';
    app.noteText = 'Remember milk';
    app.createNote();
    flushMicrotasks();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].kind).toBe('text');
    expect(app.notes()[0].text).toBe('Remember milk');
    expect(mockStorage.saveIndex).toHaveBeenCalled();
  }));

  it('should create a todo note from line-separated items', fakeAsync(() => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    flushMicrotasks();

    app.noteKind = 'todo';
    app.noteTitle = 'Weekend tasks';
    app.todoText = 'Buy food\nClean room';
    app.createNote();
    flushMicrotasks();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].kind).toBe('todo');
    expect(app.notes()[0].todos).toEqual(['Buy food', 'Clean room']);
  }));

  it('should load notes returned by StorageService.init', fakeAsync(() => {
    const savedNote: Note = {
      id: 1,
      kind: 'text',
      title: 'Saved',
      text: 'Persisted',
      createdAt: new Date().toISOString(),
      attachments: []
    };
    mockStorage.init.and.returnValue(Promise.resolve([savedNote]));

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    flushMicrotasks();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].title).toBe('Saved');
  }));

  it('should delete a note', fakeAsync(() => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    flushMicrotasks();

    app.noteKind = 'text';
    app.noteTitle = 'To delete';
    app.noteText = 'Some text';
    app.createNote();
    flushMicrotasks();

    expect(app.notes().length).toBe(1);
    const noteId = app.notes()[0].id;
    app.deleteNote(noteId);
    flushMicrotasks();

    expect(app.notes().length).toBe(0);
    expect(mockStorage.deleteNote).toHaveBeenCalledWith(noteId);
  }));

  it('should not create a note with empty title', fakeAsync(() => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    flushMicrotasks();

    app.noteKind = 'text';
    app.noteTitle = '   ';
    app.noteText = 'Some text';
    app.createNote();
    flushMicrotasks();

    expect(app.notes().length).toBe(0);
    expect(mockStorage.saveIndex).not.toHaveBeenCalled();
  }));

  it('should format file sizes correctly', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app.formatFileSize(500)).toBe('500 B');
    expect(app.formatFileSize(1536)).toBe('1.5 KB');
    expect(app.formatFileSize(2097152)).toBe('2.0 MB');
  });
});
