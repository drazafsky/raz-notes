import { Component, HostListener, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { AuthService } from './auth.service';
import { NotesStateService } from './notes-state.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  readonly notesState = inject(NotesStateService);
  private readonly router = inject(Router);
  private readonly currentUrl = signal(this.router.url);

  authError = '';
  setupUsername = '';
  setupPassword = '';
  setupPasswordConfirm = '';
  loginUsername = '';
  loginPassword = '';
  readonly notesMenuExpanded = signal(true);
  readonly mobileMenuOpen = signal(false);
  private hasCompletedInitialNavigation = false;

  constructor() {
    effect(() => {
      if (this.auth.status() !== 'unlocked') {
        this.notesState.clear();
        this.closeMobileMenu();
      }
    });
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) {
        return;
      }

      this.currentUrl.set(event.urlAfterRedirects);
      this.closeMobileMenu();

      if (!this.hasCompletedInitialNavigation) {
        this.hasCompletedInitialNavigation = true;
        return;
      }

      this.auth.recordActivity();
    });
    void this.initializeApp();
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
    this.closeMobileMenu();
  }

  toggleNotesMenu(): void {
    this.notesMenuExpanded.update((expanded) => !expanded);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.auth.lockForUnfocus();
  }

  @HostListener('document:pointerdown')
  onPointerDown(): void {
    this.auth.recordActivity();
  }

  @HostListener('document:keydown')
  onKeyDown(): void {
    this.auth.recordActivity();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.auth.lockForUnfocus();
    }
  }

  isNotesRouteActive(): boolean {
    return this.router.url.startsWith('/notes');
  }

  isSettingsRouteActive(): boolean {
    return this.router.url.startsWith('/settings');
  }

  isNoteEditorRoute(): boolean {
    return /^\/notes(?:\/new|\/\d+)(?:$|[/?#])/.test(this.currentUrl());
  }

  navigationMenuLabel(): string {
    return this.mobileMenuOpen() ? 'Close navigation menu' : 'Open navigation menu';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }

  private async initializeApp(): Promise<void> {
    try {
      await this.auth.init();
      if (this.auth.isUnlocked()) {
        await this.notesState.load();
      }
    } catch (error) {
      this.authError = this.errorMessage(error);
      this.notesState.clear();
      if (this.auth.isUnlocked()) {
        this.auth.logout();
      }
    }
  }
}
