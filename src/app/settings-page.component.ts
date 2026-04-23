import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService, LOGIN_TIMEOUT_OPTIONS } from './auth.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section
      class="rounded-lg border border-theme-border bg-theme-surface p-4 shadow-sm shadow-theme-brand/10"
    >
      <h2 class="text-2xl font-semibold text-theme-text">Settings</h2>

      <section class="mt-6 rounded-lg border border-theme-border bg-theme-bg p-4">
        <h3 class="text-lg font-semibold text-theme-text">Login</h3>
        <p class="mt-1 text-sm text-theme-muted">
          Choose how long this device stays unlocked before you need to sign in again.
        </p>

        @if (errorMessage) {
          <p
            class="mt-4 rounded border border-theme-accent-border bg-theme-accent-soft px-3 py-2 text-sm text-theme-accent"
          >
            {{ errorMessage }}
          </p>
        }

        <div class="mt-4 flex max-w-sm flex-col gap-2">
          <label for="login-timeout" class="text-sm font-medium text-theme-text"
            >Login timeout</label
          >
          <select
            id="login-timeout"
            [ngModel]="auth.loginTimeout()"
            (ngModelChange)="updateLoginTimeout($event)"
            class="rounded border border-theme-border bg-theme-surface px-3 py-2 text-sm text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-accent"
          >
            @for (option of timeoutOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>
      </section>
    </section>
  `,
})
export class SettingsPageComponent {
  readonly auth = inject(AuthService);
  readonly timeoutOptions = LOGIN_TIMEOUT_OPTIONS;
  errorMessage = '';

  async updateLoginTimeout(timeout: string): Promise<void> {
    try {
      await this.auth.setLoginTimeout(timeout as (typeof LOGIN_TIMEOUT_OPTIONS)[number]['value']);
      this.errorMessage = '';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }
}
