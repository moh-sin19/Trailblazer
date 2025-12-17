import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StarRatingComponent } from '../star-rating/star-rating.component';
import { Trail } from '../../models/trail';

@Component({
  selector: 'app-trail-card',
  standalone: true,
  imports: [RouterLink, StarRatingComponent, NgIf],
  templateUrl: './trail-card.component.html'
})
export class TrailCardComponent {
  @Input() trail!: Trail;
}
