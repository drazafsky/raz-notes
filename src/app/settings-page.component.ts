import { Component } from '@angular/core';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  template: `
    <section class="rounded-lg border border-theme-border bg-theme-surface p-4 shadow-sm shadow-theme-brand/10">
      <h2 class="text-2xl font-semibold text-theme-text">Settings</h2>
    </section>
  `
})
export class SettingsPageComponent {}
