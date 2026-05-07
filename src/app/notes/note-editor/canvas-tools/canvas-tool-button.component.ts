import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-canvas-tool-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [attr.aria-label]="ariaLabel"
      [attr.title]="title"
      [disabled]="disabled"
      [class]="buttonClasses"
      (click)="pressed.emit()"
    >
      <i [class]="icon" aria-hidden="true"></i>
    </button>
  `,
})
export class CanvasToolButtonComponent {
  @Input({ required: true }) ariaLabel!: string;
  @Input({ required: true }) title!: string;
  @Input({ required: true }) icon!: string;
  @Input() active = false;
  @Input() disabled = false;
  @Input() variant: 'toolbar' | 'floating' = 'toolbar';
  @Output() readonly pressed = new EventEmitter<void>();

  get buttonClasses(): string {
    if (this.variant === 'floating') {
      return [
        'inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-theme-surface shadow-sm shadow-theme-brand/10 transition hover:bg-theme-brand-soft focus:outline-none focus:ring-2 focus:ring-theme-accent',
        this.active
          ? 'border-theme-accent bg-theme-brand-soft text-theme-accent'
          : 'border-theme-border text-theme-text',
        this.disabled ? 'cursor-not-allowed opacity-50' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return [
      'inline-flex h-10 w-10 items-center justify-center rounded border focus:outline-none focus:ring-2 focus:ring-theme-accent',
      this.active
        ? 'border-theme-accent bg-theme-brand-soft text-theme-accent'
        : 'border-theme-border text-theme-text',
      this.disabled ? 'cursor-not-allowed opacity-50' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
