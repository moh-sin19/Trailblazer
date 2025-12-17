import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

@Component({
  selector: 'app-star-rating',
  standalone: true,
  imports: [NgFor, NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center">
      <ng-container *ngFor="let _ of stars; index as i">
        <button
          type="button"
          class="p-1"
          (click)="rate(i + 1)"
          [attr.aria-label]="'Rate ' + (i + 1)"
          [attr.aria-pressed]="value >= i + 1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-5 h-5"
            [class.text-yellow-500]="i + 1 <= value"
            [class.text-gray-300]="i + 1 > value"
          >
            <path
              d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.145 3.513a1 1 0 00.95.69h3.69c.969 0 1.371 1.24.588 1.81l-2.985 2.17a1 1 0 00-.364 1.118l1.145 3.513c.3.921-.755 1.688-1.54 1.118l-2.985-2.17a1 1 0 00-1.176 0l-2.985 2.17c-.784.57-1.838-.197-1.539-1.118l1.145-3.513a1 1 0 00-.364-1.118L2.636 8.94c-.783-.57-.38-1.81.588-1.81h3.69a1 1 0 00.95-.69l1.145-3.513z"
            />
          </svg>
        </button>
      </ng-container>
      <span *ngIf="showValue" class="ml-2 text-sm text-gray-600">{{ value.toFixed(1) }}</span>
    </div>
  `
})
export class StarRatingComponent {
  private _value = 0;

  @Input()
  set value(v: number) {
    this._value = this.clamp(Number.isFinite(v) ? v : 0);
  }
  get value(): number {
    return this._value;
  }

  @Input() max = 5;
  @Input() showValue = false;
  @Input() readonly = false;
  @Output() changed = new EventEmitter<number>();
  get stars() { return this.starsCache; }

  private get starsCache(): number[] {
    const size = Math.max(1, Math.floor(this.max));
    return Array.from({ length: size }, (_, i) => i + 1);
  }

  rate(v: number): void {
    if (this.readonly) {
      return;
    }
    this.value = v;
    this.changed.emit(this._value);
  }

  private clamp(v: number): number {
    const max = Math.max(1, Math.floor(this.max));
    if (v < 0) return 0;
    if (v > max) return max;
    return v;
  }
}
