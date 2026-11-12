import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export type GlobalAlertModalType = 'confirm' | 'alert' | 'warning' | 'danger' | 'info' | 'success';

export interface ConfirmDialogData {
  title: string;
  subtitle?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  type?: GlobalAlertModalType;
  hideCancel?: boolean;
  icon?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="modal-wrapper">
      <div class="modal-header" [ngClass]="resolvedType">
        <div class="header-main">
          <div class="header-icon-badge" [ngClass]="resolvedType">
            <mat-icon>{{ resolvedIcon }}</mat-icon>
          </div>
          <div class="header-title-box">
            <h2>{{ data.title }}</h2>
            <p *ngIf="data.subtitle">{{ data.subtitle }}</p>
          </div>
        </div>
        <button type="button" class="close-btn" (click)="dialogRef.close(false)" title="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="modal-body">
        <p [innerHTML]="data.message"></p>
      </div>

      <div class="modal-footer">
        <button *ngIf="!shouldHideCancel" type="button" class="btn-cancel" (click)="dialogRef.close(false)">
          {{ data.cancelText || 'Cancelar' }}
        </button>
        <button type="button" class="btn-confirm" [ngClass]="resolvedType" (click)="dialogRef.close(true)">
          {{ data.confirmText || (shouldHideCancel ? 'Entendi' : 'Confirmar') }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .modal-wrapper {
      display: flex;
      flex-direction: column;
      width: 100%;
      background: var(--color-surface, #ffffff);
      border-radius: 16px;
      overflow: hidden;
    }
    .modal-header {
      padding: 20px 24px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #f1f5f9;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, #ffffff 100%);
    }
    .modal-header.danger { background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, #ffffff 100%); }
    .modal-header.warning { background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, #ffffff 100%); }
    .header-main { display: flex; align-items: center; gap: 14px; }
    .header-icon-badge {
      width: 42px; height: 42px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: #eff6ff; color: #2563eb;
    }
    .header-icon-badge.danger { background: #fee2e2; color: #ef4444; }
    .header-icon-badge.warning { background: #fef3c7; color: #d97706; }
    .header-title-box h2 { font-size: 16px; font-weight: 700; margin: 0; color: #0f172a; }
    .header-title-box p { font-size: 12px; margin: 2px 0 0 0; color: #64748b; }
    .close-btn { border: none; background: transparent; cursor: pointer; color: #94a3b8; }
    .modal-body { padding: 24px; font-size: 14px; color: #334155; line-height: 1.5; }
    .modal-footer {
      display: flex; align-items: center; justify-content: flex-end; gap: 12px;
      padding: 16px 24px; border-top: 1px solid #f1f5f9; background: #ffffff;
    }
    .btn-cancel {
      padding: 0 18px; height: 38px; border-radius: 8px; border: 1.5px solid #cbd5e1;
      background: #ffffff; color: #475569; font-weight: 600; font-size: 13px; cursor: pointer;
    }
    .btn-confirm {
      padding: 0 20px; height: 38px; border-radius: 8px; border: none;
      background: #2563eb; color: #ffffff; font-weight: 600; font-size: 13px; cursor: pointer;
    }
    .btn-confirm.danger { background: #ef4444; }
    .btn-confirm.warning { background: #f59e0b; }
  `]
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {
    this.dialogRef.disableClose = true;
  }

  get resolvedType(): GlobalAlertModalType {
    if (this.data.type) return this.data.type;
    return this.data.isDestructive ? 'danger' : 'confirm';
  }

  get shouldHideCancel(): boolean {
    if (this.data.hideCancel !== undefined) return this.data.hideCancel;
    return this.data.type === 'alert' || this.data.type === 'info' || this.data.type === 'success';
  }

  get resolvedIcon(): string {
    if (this.data.icon) return this.data.icon;
    switch (this.resolvedType) {
      case 'danger': return 'warning';
      case 'warning': return 'report_problem';
      case 'success': return 'check_circle';
      case 'info':
      case 'alert': return 'info';
      default: return 'help_outline';
    }
  }
}

