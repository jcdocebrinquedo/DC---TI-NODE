import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { finalize } from 'rxjs';
import { DashboardService, FullDiagnosticReport } from './dashboard.service';
import { TabPreloaderService } from '../../core/services/tab-preloader.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  report: FullDiagnosticReport | null = null;
  loading = false;

  constructor(
    private dashboardService: DashboardService,
    private preloader: TabPreloaderService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const cached = this.preloader.getCachedData<FullDiagnosticReport>('dashboard');
    if (cached) {
      this.report = cached;
      this.cdr.detectChanges();
    } else {
      this.carregarDiagnostico();
    }
  }

  carregarDiagnostico(): void {
    this.loading = true;
    this.cdr.detectChanges();
    this.dashboardService.getFullDiagnostic()
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.report = res.data;
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Falha ao coletar diagnóstico:', err);
          this.cdr.detectChanges();
        }
      });
  }

  getScoreColor(score: number): string {
    if (score >= 90) return '#10b981';
    if (score >= 75) return '#3b82f6';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }
}

