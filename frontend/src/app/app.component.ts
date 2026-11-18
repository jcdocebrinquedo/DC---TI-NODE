import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TabPreloaderService } from './core/services/tab-preloader.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'DC-TI Support Suite';

  constructor(
    public preloader: TabPreloaderService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.preloader.startPreloadAll();
    this.preloader.stateChanged$.subscribe(() => {
      this.cdr.detectChanges();
    });
  }

  onNavClick(event: Event, key: string): void {
    if (this.preloader.isLoading(key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}
