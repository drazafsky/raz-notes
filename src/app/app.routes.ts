import { Routes } from '@angular/router';

import { NoteDetailsPageComponent } from './note-details-page.component';
import { NotesListPageComponent } from './notes-list-page.component';
import { SettingsPageComponent } from './settings-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  { path: 'notes', component: NotesListPageComponent },
  { path: 'notes/new', component: NoteDetailsPageComponent },
  { path: 'notes/:id', component: NoteDetailsPageComponent },
  { path: 'settings', component: SettingsPageComponent },
  { path: '**', redirectTo: 'notes' },
];
