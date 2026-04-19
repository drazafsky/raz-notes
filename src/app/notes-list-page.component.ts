import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AuthService } from './auth.service';
import { NotesStateService } from './notes-state.service';

@Component({
  selector: 'app-notes-list-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './notes-list-page.component.html'
})
export class NotesListPageComponent {
  readonly auth = inject(AuthService);
  readonly notesState = inject(NotesStateService);
  passwordlessError = '';

  async enablePasswordlessUnlock(): Promise<void> {
    this.passwordlessError = '';
    try {
      await this.auth.enablePasswordlessUnlock();
    } catch (error) {
      this.passwordlessError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.passwordlessError = '';
    try {
      await this.auth.disablePasswordlessUnlock();
    } catch (error) {
      this.passwordlessError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }
}
