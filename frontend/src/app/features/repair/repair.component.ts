import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { RepairService, RepairReport, RepairTaskResult, WindowsUpdateStatus } from './repair.service';
import { JobPollingService } from '../../core/services/job-polling.service';
import { TabPreloaderService } from '../../core/services/tab-preloader.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-repair',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatDialogModule],
  templateUrl: './repair.component.html',
  styleUrls: ['./repair.component.css']
})
export class RepairComponent implements OnInit {
  runningTask: string | null = null;
  activeJobProgress = 0;
  activeJobMessage = '';
  activeJobEta = '';
  tasks: RepairTaskResult[] = [];
  report: RepairReport | null = null;

  wuStatus: WindowsUpdateStatus | null = null;
  loadingWuStatus = false;

  constructor(
    private repairService: RepairService,
    private jobPolling: JobPollingService,
    private preloader: TabPreloaderService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const cached = this.preloader.getCachedData<WindowsUpdateStatus>('repair');
    if (cached) {
      this.wuStatus = cached;
      this.cdr.detectChanges();
    } else {
      this.carregarStatusWindowsUpdate();
    }
  }

  carregarStatusWindowsUpdate(): void {
    this.loadingWuStatus = true;
    this.cdr.detectChanges();
    this.repairService.getWindowsUpdateStatus()
      .pipe(finalize(() => { this.loadingWuStatus = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.wuStatus = res.data; this.cdr.detectChanges(); },
        error: () => this.cdr.detectChanges()
      });
  }

  private pushErrorTask(taskName: string, err: any): void {
    this.tasks.unshift({
      task_name: taskName,
      command: taskName,
      exit_code: err?.status || -1,
      output_summary: err?.error?.error?.message || err?.message || 'Falha ao executar rotina (verifique privilégios de Administrador).',
      success: false,
      duration_seconds: 0
    });
    this.cdr.detectChanges();
  }

  executarSpooler(): void {
    this.runningTask = 'spooler';
    this.cdr.detectChanges();
    this.repairService.runSpooler()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); },
        error: (err) => this.pushErrorTask('Reparo do Spooler de Impressão', err)
      });
  }

  executarNetwork(): void {
    this.runningTask = 'network';
    this.cdr.detectChanges();
    this.repairService.runNetwork()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); },
        error: (err) => this.pushErrorTask('Redefinição de Rede & DNS', err)
      });
  }

  executarSfc(): void {
    this.runningTask = 'sfc';
    this.activeJobProgress = 2;
    this.activeJobMessage = 'Iniciando verificação SFC...';
    this.cdr.detectChanges();
    this.repairService.startSfcAsync().subscribe({
      next: (startRes) => {
        this.jobPolling.pollJob<RepairTaskResult>(startRes.data.job_id)
          .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
          .subscribe({
            next: (job) => {
              this.activeJobProgress = job.progress;
              this.activeJobMessage = job.message;
              this.activeJobEta = job.eta_text || '';
              if (job.status === 'completed' && job.result) {
                this.tasks.unshift(job.result);
              } else if (job.status === 'failed') {
                this.pushErrorTask('Verificação de Arquivos de Sistema (SFC)', { message: job.error });
              }
              this.cdr.detectChanges();
            },
            error: (err) => this.pushErrorTask('Verificação de Arquivos de Sistema (SFC)', err)
          });
      },
      error: (err) => {
        this.runningTask = null;
        this.pushErrorTask('Verificação de Arquivos de Sistema (SFC)', err);
      }
    });
  }

  executarDism(): void {
    this.runningTask = 'dism';
    this.activeJobProgress = 2;
    this.activeJobMessage = 'Iniciando restauração DISM...';
    this.cdr.detectChanges();
    this.repairService.startDismAsync().subscribe({
      next: (startRes) => {
        this.jobPolling.pollJob<RepairTaskResult>(startRes.data.job_id)
          .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
          .subscribe({
            next: (job) => {
              this.activeJobProgress = job.progress;
              this.activeJobMessage = job.message;
              this.activeJobEta = job.eta_text || '';
              if (job.status === 'completed' && job.result) {
                this.tasks.unshift(job.result);
              } else if (job.status === 'failed') {
                this.pushErrorTask('Restauração da Imagem do Windows (DISM)', { message: job.error });
              }
              this.cdr.detectChanges();
            },
            error: (err) => this.pushErrorTask('Restauração da Imagem do Windows (DISM)', err)
          });
      },
      error: (err) => {
        this.runningTask = null;
        this.pushErrorTask('Restauração da Imagem do Windows (DISM)', err);
      }
    });
  }

  executarRestorePoint(): void {
    this.runningTask = 'restore_point';
    this.cdr.detectChanges();
    this.repairService.createRestorePoint()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); },
        error: (err) => this.pushErrorTask('Criação de Ponto de Restauração', err)
      });
  }

  agendarChkdsk(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Agendar CHKDSK',
        message: 'Deseja agendar a verificação de disco (<code>chkdsk C: /f</code>) para a próxima reinicialização do Windows?',
        type: 'warning'
      }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.runningTask = 'chkdsk';
      this.cdr.detectChanges();
      this.repairService.scheduleChkdsk('C:')
        .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
        .subscribe({
          next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); }
        });
    });
  }

  repararWindowsUpdate(): void {
    this.runningTask = 'wu_repair';
    this.cdr.detectChanges();
    this.repairService.repairWindowsUpdate()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.tasks.unshift(res.data);
          this.carregarStatusWindowsUpdate();
          this.cdr.detectChanges();
        }
      });
  }

  desabilitarWindowsUpdatePermanentemente(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        title: 'Desabilitar Windows Update Permanentemente',
        message: 'Esta ação irá desativar os serviços <strong>wuauserv, UsoSvc e WaaSMedicSvc</strong>, aplicar política <code>NoAutoUpdate=1</code> no Registro e bloquear as tarefas agendadas do Windows Update.<br><br>Deseja continuar?',
        confirmText: 'Desabilitar Permanentemente',
        type: 'warning'
      }
    });

    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.runningTask = 'wu_disable';
      this.cdr.detectChanges();
      this.repairService.disableWindowsUpdatePermanently()
        .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
        .subscribe({
          next: (res) => {
            this.tasks.unshift({
              task_name: 'Desabilitação Permanente do Windows Update',
              command: 'wuauserv/UsoSvc/WaaSMedicSvc Disabled + NoAutoUpdate=1 + Tasks',
              exit_code: 0,
              output_summary: res.data.message,
              success: true,
              duration_seconds: 1
            });
            this.carregarStatusWindowsUpdate();
            this.cdr.detectChanges();
          }
        });
    });
  }

  reativarWindowsUpdate(): void {
    this.runningTask = 'wu_enable';
    this.cdr.detectChanges();
    this.repairService.enableWindowsUpdateDefault()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.tasks.unshift({
            task_name: 'Reativação do Windows Update (Padrão)',
            command: 'Restore Services + Remove NoAutoUpdate + Enable Tasks',
            exit_code: 0,
            output_summary: res.data.message,
            success: true,
            duration_seconds: 1
          });
          this.carregarStatusWindowsUpdate();
          this.cdr.detectChanges();
        }
      });
  }

  executarSuiteCompleta(): void {
    this.runningTask = 'suite';
    this.activeJobProgress = 2;
    this.activeJobMessage = 'Iniciando suíte completa de reparo...';
    this.cdr.detectChanges();
    this.repairService.startFullSuiteAsync().subscribe({
      next: (startRes) => {
        this.jobPolling.pollJob<RepairReport>(startRes.data.job_id)
          .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
          .subscribe({
            next: (job) => {
              this.activeJobProgress = job.progress;
              this.activeJobMessage = job.message;
              this.activeJobEta = job.eta_text || '';
              if (job.status === 'completed' && job.result) {
                this.report = job.result;
                this.tasks = job.result.tasks;
              } else if (job.status === 'failed') {
                this.pushErrorTask('Suíte Completa de Reparo', { message: job.error });
              }
              this.cdr.detectChanges();
            },
            error: (err) => this.pushErrorTask('Suíte Completa de Reparo', err)
          });
      },
      error: (err) => {
        this.runningTask = null;
        this.pushErrorTask('Suíte Completa de Reparo', err);
      }
    });
  }
}
