import { TestBed } from '@angular/core/testing';
import { App, NOTES_STORAGE_KEY } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should create a plain text note and persist it', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.noteKind = 'text';
    app.noteTitle = 'My text note';
    app.noteText = 'Remember milk';
    app.createNote();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].kind).toBe('text');
    expect(app.notes()[0].text).toBe('Remember milk');
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).toContain('My text note');
  });

  it('should create a todo note from line-separated items', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.noteKind = 'todo';
    app.noteTitle = 'Weekend tasks';
    app.todoText = 'Buy food\nClean room';
    app.createNote();

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].kind).toBe('todo');
    expect(app.notes()[0].todos).toEqual(['Buy food', 'Clean room']);
  });

  it('should load saved notes from local storage', () => {
    localStorage.setItem(
      NOTES_STORAGE_KEY,
      JSON.stringify([
        {
          id: 1,
          kind: 'text',
          title: 'Saved',
          text: 'Persisted',
          createdAt: new Date().toISOString()
        }
      ])
    );

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app.notes().length).toBe(1);
    expect(app.notes()[0].title).toBe('Saved');
  });
});
