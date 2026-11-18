import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { CleanupService, CleanupReport, StorageAnalysis } from './cleanup.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-cleanup',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatDialogModule],
  templateUrl: './cleanup.component.html',
  styleUrls: ['./cleanup.component.css']
})
export class CleanupComponent {
  cleanUserTemp = true;
  cleanWindowsTemp = true;
  cleanPrefetch = true;
  cleanWindowsUpdate = true;
  flushDns = true;
  cleanBrowserCache = false;
  cleanTeamsCache = false;
  cleanWinSxS = false;

  report: CleanupReport | null = null;
  storageAnalysis: StorageAnalysis | null = null;
  loading = false;
  loadingAnalysis = false;

  constructor(
    private cleanupService: CleanupService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  executarLimpeza(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '440px',
      disableClose: true,
      data: {
        title: 'Iniciar Limpeza Avançada',
        message: 'Deseja remover os arquivos temporários e caches selecionados (e esvaziar DNS)?',
        confirmText: 'Limpar Agora',
        type: 'warning'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.loading = true;
      this.cdr.detectChanges();

      const opts = {
        clean_user_temp: this.cleanUserTemp,
        clean_windows_temp: this.cleanWindowsTemp,
        clean_prefetch: this.cleanPrefetch,
        clean_windows_update_cache: this.cleanWindowsUpdate,
        flush_dns_cache: this.flushDns,
        clean_browser_cache: this.cleanBrowserCache,
        clean_teams_cache: this.cleanTeamsCache,
        clean_winsxs: this.cleanWinSxS
      };

      this.cleanupService.runCleanup(opts)
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
            console.error('Falha na limpeza:', err);
            this.cdr.detectChanges();
          }
        });
    });
  }

  analisarEspaco(): void {
    this.loadingAnalysis = true;
    this.cdr.detectChanges();
    this.cleanupService.analyzeStorage('C:\\')
      .pipe(finalize(() => { this.loadingAnalysis = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.storageAnalysis = res.data;
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      });
  }
}
