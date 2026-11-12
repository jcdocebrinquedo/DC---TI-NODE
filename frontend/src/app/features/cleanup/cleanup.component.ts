import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { CleanupService, CleanupReport } from './cleanup.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-cleanup',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule],
  templateUrl: './cleanup.component.html',
  styleUrls: ['./cleanup.component.css']
})
export class CleanupComponent {
  cleanUserTemp = true;
  cleanWindowsTemp = true;
  cleanPrefetch = true;
  cleanWindowsUpdate = true;
  flushDns = true;

  report: CleanupReport | null = null;
  loading = false;

  constructor(
    private cleanupService: CleanupService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  executarLimpeza(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Iniciar Limpeza Expressa',
        message: 'Deseja remover arquivos temporários, logs antigos e esvaziar o cache DNS do sistema?',
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
        flush_dns_cache: this.flushDns
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
}

