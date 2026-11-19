import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { HostnameService, HostnameInfo } from './hostname.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-hostname',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule],
  templateUrl: './hostname.component.html',
  styleUrls: ['./hostname.component.css']
})
export class HostnameComponent implements OnInit {
  info: HostnameInfo | null = null;
  newHostname = '';
  loadingCarregar = false;
  loadingAlterar = false;

  constructor(
    private hostnameService: HostnameService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.carregarDados();
  }

  carregarDados(): void {
    this.loadingCarregar = true;
    this.cdr.detectChanges();
    this.hostnameService.getInfo()
      .pipe(finalize(() => {
        this.loadingCarregar = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.info = res.data;
          this.newHostname = res.data.active_name;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.cdr.detectChanges();
          this.dialog.open(ConfirmDialogComponent, {
            width: '420px',
            disableClose: true,
            data: {
              title: 'Erro de Leitura',
              message: `Não foi possível obter o Hostname do Registro: ${err.error?.error?.message || err.message}`,
              type: 'danger',
              hideCancel: true
            }
          });
        }
      });
  }

  alterarHostname(): void {
    const target = this.newHostname.trim().toUpperCase();
    if (!target) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Confirmar Alteração de Hostname',
        message: `Deseja realmente alterar o Hostname da máquina para <strong>${target}</strong> no Registro HKLM?`,
        confirmText: 'Alterar Hostname',
        isDestructive: false,
        type: 'confirm'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;

      this.loadingAlterar = true;
      this.cdr.detectChanges();
      this.hostnameService.setHostname(target)
        .pipe(finalize(() => {
          this.loadingAlterar = false;
          this.cdr.detectChanges();
        }))
        .subscribe({
          next: (res) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '440px',
              disableClose: true,
              data: {
                title: 'Hostname Alterado com Sucesso',
                message: `O Hostname foi atualizado de <strong>${res.data.previous_name}</strong> para <strong>${res.data.new_name}</strong>.<br><br>Será necessário reiniciar o Windows para refletir em toda a rede.`,
                type: 'success',
                hideCancel: true
              }
            });
            this.carregarDados();
          },
          error: (err) => {
            this.cdr.detectChanges();
            this.dialog.open(ConfirmDialogComponent, {
              width: '440px',
              disableClose: true,
              data: {
                title: 'Falha ao Gravar no Registro',
                message: err.error?.error?.message || 'Permissão de Administrador necessária.',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }
}

