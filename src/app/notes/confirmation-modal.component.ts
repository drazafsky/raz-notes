import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirmation-modal',
  template: `
    <button
      type="button"
      aria-label="Close dialog"
      class="fixed inset-0 z-40 bg-theme-backdrop/45"
      (click)="cancelled.emit()"
    ></button>
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId()"
        [attr.aria-describedby]="descriptionId()"
        class="w-full max-w-md rounded-lg border border-theme-border bg-theme-surface p-5 shadow-xl shadow-theme-backdrop/20"
      >
        <h2 [id]="titleId()" class="text-lg font-semibold text-theme-text">{{ title() }}</h2>
        <p [id]="descriptionId()" class="mt-2 text-sm text-theme-muted">{{ message() }}</p>

        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded border border-theme-border px-3 py-1.5 text-sm text-theme-text hover:bg-theme-brand-soft focus:outline-none focus:ring-2 focus:ring-theme-brand"
            (click)="cancelled.emit()"
          >
            {{ cancelLabel() }}
          </button>
          <button
            type="button"
            class="rounded border border-theme-accent-border bg-theme-accent-soft px-3 py-1.5 text-sm font-medium text-theme-accent hover:bg-theme-accent-soft/80 focus:outline-none focus:ring-2 focus:ring-theme-accent"
            (click)="confirmed.emit()"
          >
            {{ confirmLabel() }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmationModalComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly dialogId = input('confirmation-modal');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  titleId(): string {
    return `${this.dialogId()}-title`;
  }

  descriptionId(): string {
    return `${this.dialogId()}-description`;
  }
}
