import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { ServiceOrderService, ServiceOrderOutput } from './service-order.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-service-order',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule],
  templateUrl: './service-order.component.html',
  styleUrls: ['./service-order.component.css']
})
export class ServiceOrderComponent implements OnInit {
  stationName = '';
  technicianName = '';
  userName = '';
  newAction = '';
  actions: string[] = [];

  result: ServiceOrderOutput | null = null;
  loadingGenerate = false;

  constructor(
    private osService: ServiceOrderService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Inicializa os campos totalmente vazios sem auto-preenchimento
    this.cdr.detectChanges();
  }

  adicionarAcao(): void {
    const text = this.newAction.trim();
    if (text) {
      this.actions.push(text);
      this.newAction = '';
      this.cdr.detectChanges();
    }
  }

  removerAcao(idx: number): void {
    this.actions.splice(idx, 1);
    this.cdr.detectChanges();
  }

  gerarOrdemServico(): void {
    if (this.actions.length === 0) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        disableClose: true,
        data: {
          title: 'Atenção',
          message: 'Adicione pelo menos uma ação realizada antes de gerar o documento.',
          type: 'warning',
          hideCancel: true
        }
      });
      return;
    }

    this.loadingGenerate = true;
    this.cdr.detectChanges();

    const payload = {
      station_name: this.stationName,
      technician_name: this.technicianName,
      user_name: this.userName,
      actions_performed: this.actions
    };

    this.osService.generateOrder(payload)
      .pipe(finalize(() => { this.loadingGenerate = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.result = res.data;
          this.dialog.open(ConfirmDialogComponent, {
            width: '440px',
            disableClose: true,
            data: {
              title: 'Ordem de Serviço Emitida',
              message: `Ordem de Serviço <strong>${res.data.order_id}</strong> gerada com sucesso em Documentos/DC-TI.<br><br>Formatos gerados: Markdown (.md) e Texto (.txt).`,
              type: 'success',
              hideCancel: true
            }
          });
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Falha ao gerar OS:', err);
          this.cdr.detectChanges();
        }
      });
  }
}

