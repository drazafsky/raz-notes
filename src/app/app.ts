import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { AuthService } from './auth.service';
import { NotesStateService } from './notes-state.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly auth = inject(AuthService);
  private readonly notesState = inject(NotesStateService);

  authError = '';
  setupUsername = '';
  setupPassword = '';
  setupPasswordConfirm = '';
  loginUsername = '';
  loginPassword = '';

  constructor() {
    void this.auth.init();
  }

  async setupAccount(): Promise<void> {
    this.authError = '';

    if (this.setupPassword !== this.setupPasswordConfirm) {
      this.authError = 'Passwords do not match.';
      return;
    }

    try {
      await this.auth.createAccount(this.setupUsername, this.setupPassword);
      this.loginUsername = this.setupUsername.trim();
      this.setupUsername = '';
      this.setupPassword = '';
      this.setupPasswordConfirm = '';
      await this.notesState.load();
    } catch (error) {
      this.auth.logout();
      this.authError = this.errorMessage(error);
    }
  }

  async login(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.login(this.loginUsername, this.loginPassword);
      await this.notesState.load();
      this.loginPassword = '';
    } catch (error) {
      this.notesState.clear();
      if (this.auth.isUnlocked()) {
        this.auth.logout();
      }
      this.authError = this.errorMessage(error);
    }
  }

  async loginWithDevice(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.loginWithDevice();
      await this.notesState.load();
      this.loginPassword = '';
    } catch (error) {
      this.notesState.clear();
      if (this.auth.isUnlocked()) {
        this.auth.logout();
      }
      this.authError = this.errorMessage(error);
    }
  }

  async enablePasswordlessUnlock(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.enablePasswordlessUnlock();
    } catch (error) {
      this.authError = this.errorMessage(error);
    }
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.disablePasswordlessUnlock();
    } catch (error) {
      this.authError = this.errorMessage(error);
    }
  }

  logout(): void {
    this.auth.logout();
    this.notesState.clear();
    this.loginPassword = '';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
