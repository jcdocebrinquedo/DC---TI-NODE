import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { ServiceOrderService, ServiceOrderOutput } from './service-order.service';
import { TabPreloaderService } from '../../core/services/tab-preloader.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-service-order',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatDialogModule],
  templateUrl: './service-order.component.html',
  styleUrls: ['./service-order.component.css']
})
export class ServiceOrderComponent implements OnInit {
  stationName = '';
  technicianName = '';
  userName = '';
  summary = '';
  newAction = '';
  actions: string[] = [];

  result: ServiceOrderOutput | null = null;
  history: ServiceOrderOutput[] = [];

  loadingGenerate = false;
  loadingSummary = false;
  loadingSession = false;
  loadingHistory = false;

  constructor(
    private osService: ServiceOrderService,
    private preloader: TabPreloaderService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const cached = this.preloader.getCachedData<{ first: any; second: ServiceOrderOutput[] }>('service-order');
    if (cached) {
      if (cached.first?.stationName && !this.stationName) this.stationName = cached.first.stationName;
      const list = (cached.first?.actions || []).map((a: any) => `[${a.timestamp}] ${a.description}`);
      if (list.length > 0) this.actions = list;
      this.history = cached.second || [];
      this.cdr.detectChanges();
    } else {
      this.carregarSessao();
      this.carregarHistorico();
    }
  }

  carregarSessao(): void {
    this.loadingSession = true;
    this.cdr.detectChanges();
    this.osService.getSession()
      .pipe(finalize(() => { this.loadingSession = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          if (res.data?.stationName && !this.stationName) {
            this.stationName = res.data.stationName;
          }
          const sessionList = (res.data?.actions || []).map(a => `[${a.timestamp}] ${a.description}`);
          if (sessionList.length > 0) {
            this.actions = sessionList;
          }
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      });
  }

  limparSessao(): void {
    this.osService.clearSession().subscribe({
      next: (res) => {
        this.actions = [];
        this.summary = '';
        this.stationName = res.data?.stationName || '';
        this.cdr.detectChanges();
      }
    });
  }

  carregarHistorico(): void {
    this.loadingHistory = true;
    this.cdr.detectChanges();
    this.osService.getHistory()
      .pipe(finalize(() => { this.loadingHistory = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.history = res.data || [];
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      });
  }

  puxarDoHistorico(order: ServiceOrderOutput): void {
    this.osService.restoreFromHistory(order.order_id).subscribe({
      next: (res) => {
        const item = res.data;
        this.stationName = item.station_name || '';
        this.technicianName = item.technician_name || '';
        this.userName = item.user_name || '';
        this.summary = item.summary || '';
        this.actions = [...(item.actions_performed || [])];
        this.result = item;
        this.dialog.open(ConfirmDialogComponent, {
          width: '420px',
          disableClose: true,
          data: {
            title: 'Histórico Restaurado',
            message: `Os dados e a lista de ações da OS <strong>${item.order_id}</strong> foram carregados para a Ordem de Serviço atual.`,
            type: 'info',
            hideCancel: true
          }
        });
        this.cdr.detectChanges();
      }
    });
  }

  excluirHistorico(order: ServiceOrderOutput): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      disableClose: true,
      data: {
        title: 'Remover do Histórico',
        message: `Deseja remover o registro <strong>${order.order_id}</strong> do histórico? (Os arquivos já salvos em Documentos não serão apagados.)`,
        type: 'warning'
      }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.osService.deleteFromHistory(order.order_id).subscribe({
          next: () => this.carregarHistorico()
        });
      }
    });
  }

  gerarResumoIA(): void {
    if (this.actions.length === 0) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        disableClose: true,
        data: {
          title: 'Lista Vazia',
          message: 'Adicione ou carregue pelo menos uma ação realizada para gerar o resumo executivo.',
          type: 'warning',
          hideCancel: true
        }
      });
      return;
    }

    this.loadingSummary = true;
    this.cdr.detectChanges();
    this.osService.generateAiSummary(this.actions, this.stationName)
      .pipe(finalize(() => { this.loadingSummary = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.summary = res.data?.summary || '';
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      });
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
    if (!this.stationName.trim() || !this.technicianName.trim()) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        disableClose: true,
        data: {
          title: 'Campos Obrigatórios',
          message: 'Informe o <strong>Nome da Estação</strong> e o <strong>Técnico Responsável</strong> antes de emitir a Ordem de Serviço.',
          type: 'warning',
          hideCancel: true
        }
      });
      return;
    }

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
      summary: this.summary,
      actions_performed: this.actions
    };

    this.osService.generateOrder(payload)
      .pipe(finalize(() => { this.loadingGenerate = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.result = res.data;
          // Após gerar, zera a lista atual e resumo para iniciar o próximo atendimento limpo
          this.actions = [];
          this.summary = '';
          this.carregarHistorico();

          this.dialog.open(ConfirmDialogComponent, {
            width: '460px',
            disableClose: true,
            data: {
              title: 'Ordem de Serviço Emitida',
              message: `Ordem de Serviço <strong>${res.data.order_id}</strong> salva no histórico e gerada em <strong>PDF</strong>.<br><br>A sessão atual foi zerada automaticamente para o próximo atendimento.`,
              type: 'success',
              hideCancel: true
            }
          });
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.dialog.open(ConfirmDialogComponent, {
            width: '420px',
            disableClose: true,
            data: {
              title: 'Erro ao Gerar OS',
              message: err.error?.error?.message || 'Falha ao gerar os documentos da Ordem de Serviço.',
              type: 'danger',
              hideCancel: true
            }
          });
          this.cdr.detectChanges();
        }
      });
  }

  abrirArquivo(filePath: string): void {
    if (!filePath) return;
    this.osService.openFile(filePath).subscribe();
  }

  abrirPasta(): void {
    this.osService.openFolder().subscribe();
  }
}
