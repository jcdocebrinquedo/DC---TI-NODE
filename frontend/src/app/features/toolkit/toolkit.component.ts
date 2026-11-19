import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs/operators';
import {
  SystemFeaturesService,
  NetworkDiagnostics,
  StartupProgram,
  CrashReport,
  StressTestResult,
  BackupEstimate,
  WingetPackage,
  PrinterItem,
  SystemInventory,
  InstalledSoftwareItem,
  RemoteAccessIds
} from '../../core/services/system-features.service';
import { JobPollingService } from '../../core/services/job-polling.service';
import { TabPreloaderService } from '../../core/services/tab-preloader.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

type ToolkitTab = 'network' | 'printers' | 'winget' | 'inventory' | 'startup' | 'crashes' | 'stress' | 'backup' | 'runbooks';

@Component({
  selector: 'app-toolkit',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatDialogModule],
  templateUrl: './toolkit.component.html',
  styleUrls: ['./toolkit.component.css']
})
export class ToolkitComponent implements OnInit {
  activeTab: ToolkitTab = 'network';

  // Dados
  networkData: NetworkDiagnostics | null = null;
  networkError: string | null = null;
  startupList: StartupProgram[] = [];
  crashData: CrashReport | null = null;
  stressResult: StressTestResult | null = null;
  backupData: BackupEstimate | null = null;
  backupDestination = 'D:\\Backup_DC_TI';
  backupSelectedFolders: Record<string, boolean> = {
    desktop: true,
    documents: true,
    downloads: true,
    pictures: false,
    favorites: true,
    outlook: false
  };
  backupRunResult: any = null;

  // Winget
  wingetPackages: WingetPackage[] = [];
  wingetRawOutput = '';
  wingetActionMsg = '';

  // Impressoras
  printers: PrinterItem[] = [];

  // Inventário & Softwares
  inventoryData: SystemInventory | null = null;
  installedSoftware: InstalledSoftwareItem[] = [];
  softwareFilter = '';
  selectedSoftwareKeys = new Set<string>();
  uninstallingSoftware = false;
  remoteIds: RemoteAccessIds | null = null;

  // Runbooks guiados
  runbooks = [
    {
      title: 'Setup de Máquina Nova / Entrega ao Usuário',
      steps: [
        { label: 'Definir Hostname padrão corporativo', done: false },
        { label: 'Atualizar softwares essenciais via Winget', done: false },
        { label: 'Configurar impressoras de rede e página de teste', done: false },
        { label: 'Validar antivírus (Defender) e Firewall ativos', done: false }
      ]
    },
    {
      title: 'Diagnóstico de Lentidão Crônica',
      steps: [
        { label: 'Auditar saúde SMART do SSD/HDD e espaço livre', done: false },
        { label: 'Executar Limpeza Avançada (Temp, Navegadores, Teams)', done: false },
        { label: 'Desabilitar programas desnecessários no Boot', done: false },
        { label: 'Executar SFC / DISM e verificar temperaturas no Stress Test', done: false }
      ]
    }
  ];

  // Loadings
  loadingNetwork = false;
  loadingDhcp = false;
  loadingStartup = false;
  loadingCrashes = false;
  loadingStress = false;
  loadingBackup = false;
  loadingBackupRun = false;
  loadingWinget = false;
  upgradingWingetId: string | null = null;
  loadingPrinters = false;
  loadingInventory = false;
  loadingSoftware = false;

  // Progress bars para operações longas
  wingetProgress = 0;
  wingetProgressMsg = '';
  wingetProgressEta = '';
  backupProgress = 0;
  backupProgressMsg = '';
  backupProgressEta = '';
  stressProgress = 0;
  private stressTimer: any = null;

  constructor(
    private featuresService: SystemFeaturesService,
    private jobPolling: JobPollingService,
    public preloader: TabPreloaderService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.preloader.stateChanged$.subscribe(() => {
      if (this.activeTab === 'network' && !this.networkData) {
        const st = this.preloader.getState('tk:network');
        if (st.status === 'ready' && st.data) {
          this.networkData = st.data;
          this.networkError = null;
        } else if (st.status === 'error' && !this.loadingNetwork && !this.networkError) {
          this.carregarNetwork();
        }
      }
      this.cdr.detectChanges();
    });
    this.hydrateOrLoadTab('network');
  }

  isSubTabLoading(tab: ToolkitTab): boolean {
    if (tab === 'stress') return false;
    return this.preloader.isLoading(`tk:${tab}`);
  }

  getSubTabProgress(tab: ToolkitTab): number {
    return this.preloader.getProgress(`tk:${tab}`);
  }

  setTab(tab: ToolkitTab): void {
    if (tab !== this.activeTab && this.isSubTabLoading(tab)) return;
    this.activeTab = tab;
    this.hydrateOrLoadTab(tab);
  }

  private hydrateOrLoadTab(tab: ToolkitTab): void {
    if (tab === 'network' && !this.networkData) {
      const st = this.preloader.getState('tk:network');
      if (st.status === 'ready' && st.data) {
        this.networkData = st.data;
        this.networkError = null;
      } else if (st.status !== 'loading') {
        this.carregarNetwork();
      }
    }
    if (tab === 'printers' && this.printers.length === 0) {
      const c = this.preloader.getCachedData<PrinterItem[]>('tk:printers');
      if (c) this.printers = c; else this.carregarImpressoras();
    }
    if (tab === 'winget' && this.wingetPackages.length === 0 && !this.wingetRawOutput) {
      const c = this.preloader.getCachedData<{ packages: WingetPackage[]; output: string }>('tk:winget');
      if (c) { this.wingetPackages = c.packages || []; this.wingetRawOutput = c.output || ''; } else this.carregarWinget();
    }
    if (tab === 'inventory' && !this.inventoryData) {
      const c = this.preloader.getCachedData<{ first: SystemInventory; second: InstalledSoftwareItem[] }>('tk:inventory');
      if (c) { this.inventoryData = c.first; this.installedSoftware = c.second || []; }
      else { this.carregarInventario(); this.carregarSoftwaresInstalados(); }
    }
    if (tab === 'startup' && this.startupList.length === 0) {
      const c = this.preloader.getCachedData<StartupProgram[]>('tk:startup');
      if (c) this.startupList = c; else this.carregarStartup();
    }
    if (tab === 'crashes' && !this.crashData) {
      const c = this.preloader.getCachedData<CrashReport>('tk:crashes');
      if (c) this.crashData = c; else this.carregarCrashes();
    }
    if (tab === 'backup' && !this.backupData) {
      const c = this.preloader.getCachedData<BackupEstimate>('tk:backup');
      if (c) this.backupData = c; else this.carregarBackup();
    }
    if (tab === 'runbooks' && !this.remoteIds) {
      const c = this.preloader.getCachedData<RemoteAccessIds>('tk:runbooks');
      if (c) this.remoteIds = c; else this.carregarRemoteIds();
    }
  }

  // --- NETWORK ---
  carregarNetwork(): void {
    this.loadingNetwork = true;
    this.networkError = null;
    this.cdr.detectChanges();
    this.featuresService.getNetworkDoctor()
      .pipe(finalize(() => { this.loadingNetwork = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.networkData = res.data;
          this.preloader.setReadyData('tk:network', res.data);
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.networkError = err?.error?.error?.message || err?.message || 'Não foi possível executar os testes de rede.';
          this.cdr.detectChanges();
        }
      });
  }

  renovarDhcp(): void {
    this.loadingDhcp = true;
    this.cdr.detectChanges();
    this.featuresService.renewDhcp()
      .pipe(finalize(() => { this.loadingDhcp = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.dialog.open(ConfirmDialogComponent, {
            width: '420px',
            disableClose: true,
            data: { title: 'DHCP Renovado', message: res.data.message, type: 'success', hideCancel: true }
          });
          this.carregarNetwork();
        }
      });
  }

  // --- WINGET ---
  carregarWinget(): void {
    this.loadingWinget = true;
    this.wingetActionMsg = '';
    this.cdr.detectChanges();
    this.featuresService.getWingetUpdates()
      .pipe(finalize(() => { this.loadingWinget = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.wingetPackages = res.data.packages || [];
          this.wingetRawOutput = res.data.output || '';
          this.cdr.detectChanges();
        }
      });
  }

  atualizarPacoteWinget(packageId: string): void {
    this.upgradingWingetId = packageId;
    this.wingetActionMsg = '';
    this.wingetProgress = 5;
    this.wingetProgressMsg = packageId === '__ALL__'
      ? `Iniciando atualização de ${this.wingetPackages.length} pacote(s)...`
      : `Iniciando atualização de ${packageId}...`;
    this.cdr.detectChanges();

    const allIds = packageId === '__ALL__' ? this.wingetPackages.map(p => p.id) : [];
    this.featuresService.startWingetUpgradeAsync(packageId, allIds).subscribe({
      next: (startRes) => {
        this.jobPolling.pollJob(startRes.data.job_id)
          .pipe(finalize(() => { this.upgradingWingetId = null; this.cdr.detectChanges(); }))
          .subscribe({
            next: (job) => {
              this.wingetProgress = job.progress;
              this.wingetProgressMsg = job.message;
              this.wingetProgressEta = job.eta_text || '';
              if (job.status === 'completed') {
                this.wingetActionMsg = job.result?.output || job.message;
                this.carregarWinget();
              } else if (job.status === 'failed') {
                this.wingetActionMsg = `Erro na atualização: ${job.error}`;
              }
              this.cdr.detectChanges();
            },
            error: (err) => {
              this.wingetActionMsg = err.error?.error?.message || 'Falha ao acompanhar atualização Winget.';
              this.cdr.detectChanges();
            }
          });
      },
      error: (err) => {
        this.upgradingWingetId = null;
        this.wingetActionMsg = err.error?.error?.message || 'Falha ao iniciar atualização Winget.';
        this.cdr.detectChanges();
      }
    });
  }

  // --- IMPRESSORAS ---
  carregarImpressoras(): void {
    this.loadingPrinters = true;
    this.cdr.detectChanges();
    this.featuresService.listPrinters()
      .pipe(finalize(() => { this.loadingPrinters = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.printers = res.data || []; this.cdr.detectChanges(); }
      });
  }

  limparFilaImpressora(p: PrinterItem): void {
    this.featuresService.clearPrinterQueue(p.name).subscribe({
      next: () => this.carregarImpressoras()
    });
  }

  definirImpressoraPadrao(p: PrinterItem): void {
    this.featuresService.setDefaultPrinter(p.name).subscribe({
      next: () => this.carregarImpressoras()
    });
  }

  imprimirPaginaTeste(p: PrinterItem): void {
    this.featuresService.printTestPage(p.name).subscribe({
      next: () => {
        this.dialog.open(ConfirmDialogComponent, {
          width: '380px',
          disableClose: true,
          data: { title: 'Página de Teste', message: `Página de teste enviada para <strong>${p.name}</strong>.`, type: 'success', hideCancel: true }
        });
      }
    });
  }

  // --- INVENTÁRIO & SOFTWARES (MULTI-SELEÇÃO + NORMAL / PROFUNDA REVO) ---
  carregarInventario(): void {
    this.loadingInventory = true;
    this.cdr.detectChanges();
    this.featuresService.getFullInventory()
      .pipe(finalize(() => { this.loadingInventory = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.inventoryData = res.data; this.cdr.detectChanges(); }
      });
  }

  carregarSoftwaresInstalados(): void {
    this.loadingSoftware = true;
    this.selectedSoftwareKeys.clear();
    this.cdr.detectChanges();
    this.featuresService.listInstalledSoftware()
      .pipe(finalize(() => { this.loadingSoftware = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.installedSoftware = res.data || []; this.cdr.detectChanges(); }
      });
  }

  softwareKey(app: InstalledSoftwareItem): string {
    return app.reg_key_path || `${app.name}::${app.version}`;
  }

  isSoftwareSelected(app: InstalledSoftwareItem): boolean {
    return this.selectedSoftwareKeys.has(this.softwareKey(app));
  }

  toggleSoftwareSelection(app: InstalledSoftwareItem): void {
    const key = this.softwareKey(app);
    if (this.selectedSoftwareKeys.has(key)) {
      this.selectedSoftwareKeys.delete(key);
    } else {
      this.selectedSoftwareKeys.add(key);
    }
  }

  get allFilteredSelected(): boolean {
    const list = this.filteredSoftware.filter(s => Boolean(s.uninstall_string));
    return list.length > 0 && list.every(s => this.selectedSoftwareKeys.has(this.softwareKey(s)));
  }

  toggleSelectAllFiltered(): void {
    const list = this.filteredSoftware.filter(s => Boolean(s.uninstall_string));
    if (this.allFilteredSelected) {
      list.forEach(s => this.selectedSoftwareKeys.delete(this.softwareKey(s)));
    } else {
      list.forEach(s => this.selectedSoftwareKeys.add(this.softwareKey(s)));
    }
  }

  get selectedSoftwareItems(): InstalledSoftwareItem[] {
    return this.installedSoftware.filter(s => this.selectedSoftwareKeys.has(this.softwareKey(s)));
  }

  desinstalarSoftware(app: InstalledSoftwareItem, deep: boolean): void {
    const modo = deep ? 'Profunda (Estilo Revo Uninstaller)' : 'Normal';
    const detalhes = deep
      ? 'O desinstalador padrão será executado e, em seguida, todas as pastas residuais, chaves de Registro e atalhos desse software serão removidos.'
      : 'Será executado apenas o desinstalador padrão do programa.';

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: `Desinstalação ${modo}`,
        message: `Deseja desinstalar <strong>${app.name}</strong>?<br><br>${detalhes}`,
        confirmText: deep ? 'Desinstalar Profundamente' : 'Desinstalar Normal',
        type: 'warning'
      }
    });

    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.uninstallingSoftware = true;
      this.cdr.detectChanges();
      this.featuresService.uninstallSoftware(app, deep)
        .pipe(finalize(() => { this.uninstallingSoftware = false; this.cdr.detectChanges(); }))
        .subscribe({
          next: (res) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '450px',
              disableClose: true,
              data: {
                title: 'Desinstalação Concluída',
                message: res.data?.message || `<strong>${app.name}</strong> desinstalado.`,
                type: 'success',
                hideCancel: true
              }
            });
            this.carregarSoftwaresInstalados();
          },
          error: (err) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Erro na Desinstalação',
                message: err.error?.error?.message || 'Não foi possível concluir a desinstalação.',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }

  desinstalarSelecionados(deep: boolean): void {
    const items = this.selectedSoftwareItems;
    if (items.length === 0) return;

    const modo = deep ? 'Profunda (Estilo Revo)' : 'Normal';
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        title: `Desinstalação em Lote (${modo})`,
        message: `Deseja desinstalar os <strong>${items.length}</strong> software(s) selecionado(s) no modo <strong>${modo}</strong>?`,
        confirmText: `Desinstalar (${items.length})`,
        type: 'warning'
      }
    });

    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.uninstallingSoftware = true;
      this.cdr.detectChanges();
      this.featuresService.uninstallMultipleSoftware(items, deep)
        .pipe(finalize(() => { this.uninstallingSoftware = false; this.cdr.detectChanges(); }))
        .subscribe({
          next: (res) => {
            const d = res.data;
            this.dialog.open(ConfirmDialogComponent, {
              width: '450px',
              disableClose: true,
              data: {
                title: 'Desinstalação em Lote Finalizada',
                message: `Concluídos: <strong>${d.succeeded}/${d.total}</strong> (Falhas: ${d.failed}).`,
                type: d.failed === 0 ? 'success' : 'warning',
                hideCancel: true
              }
            });
            this.carregarSoftwaresInstalados();
          },
          error: (err) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Erro na Desinstalação em Lote',
                message: err.error?.error?.message || 'Falha ao processar a desinstalação em lote.',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }

  get filteredSoftware(): InstalledSoftwareItem[] {
    const q = this.softwareFilter.trim().toLowerCase();
    if (!q) return this.installedSoftware;
    return this.installedSoftware.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.publisher || '').toLowerCase().includes(q)
    );
  }

  // --- BOOT ---
  carregarStartup(): void {
    this.loadingStartup = true;
    this.cdr.detectChanges();
    this.featuresService.getStartupPrograms()
      .pipe(finalize(() => { this.loadingStartup = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.startupList = res.data || []; this.cdr.detectChanges(); },
        error: () => { this.startupList = []; this.cdr.detectChanges(); }
      });
  }

  removerStartup(item: StartupProgram): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Desabilitar Inicialização',
        message: `Deseja remover/desabilitar <strong>${item.name}</strong> da inicialização automática do Windows?`,
        type: 'warning'
      }
    });
    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.featuresService.removeStartupProgram(item).subscribe({
        next: (res) => {
          this.dialog.open(ConfirmDialogComponent, {
            width: '400px',
            disableClose: true,
            data: { title: 'Boot Atualizado', message: res.data?.message || 'Item desabilitado com sucesso.', type: 'success', hideCancel: true }
          });
          this.carregarStartup();
        },
        error: (err) => {
          this.dialog.open(ConfirmDialogComponent, {
            width: '420px',
            disableClose: true,
            data: {
              title: 'Erro ao Desabilitar Item',
              message: err.error?.error?.message || 'Permissão negada ou item não encontrado (execute como Administrador).',
              type: 'danger',
              hideCancel: true
            }
          });
        }
      });
    });
  }

  // --- BSOD ---
  carregarCrashes(): void {
    this.loadingCrashes = true;
    this.cdr.detectChanges();
    this.featuresService.getCrashReports()
      .pipe(finalize(() => { this.loadingCrashes = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.crashData = res.data; this.cdr.detectChanges(); }
      });
  }

  // --- STRESS TEST ---
  executarStressTest(): void {
    this.loadingStress = true;
    this.stressResult = null;
    this.stressProgress = 0;
    if (this.stressTimer) clearInterval(this.stressTimer);
    this.stressTimer = setInterval(() => {
      if (this.stressProgress < 95) {
        this.stressProgress = Math.min(95, this.stressProgress + 5);
        this.cdr.detectChanges();
      }
    }, 500);
    this.cdr.detectChanges();
    this.featuresService.runStressTest(10)
      .pipe(finalize(() => {
        if (this.stressTimer) { clearInterval(this.stressTimer); this.stressTimer = null; }
        this.stressProgress = 100;
        this.loadingStress = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => { this.stressResult = res.data; this.cdr.detectChanges(); }
      });
  }

  pararStressTest(): void {
    this.featuresService.stopStressTest().subscribe({
      next: () => {
        if (this.stressTimer) { clearInterval(this.stressTimer); this.stressTimer = null; }
        this.loadingStress = false;
        this.cdr.detectChanges();
      }
    });
  }

  // --- BACKUP (.TAR) ---
  carregarBackup(): void {
    this.loadingBackup = true;
    this.cdr.detectChanges();
    this.featuresService.getBackupEstimate()
      .pipe(finalize(() => { this.loadingBackup = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.backupData = res.data; this.cdr.detectChanges(); }
      });
  }

  executarBackupTar(): void {
    const selected = Object.entries(this.backupSelectedFolders)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!this.backupDestination.trim() || selected.length === 0) return;

    this.loadingBackupRun = true;
    this.backupRunResult = null;
    this.backupProgress = 2;
    this.backupProgressMsg = 'Contando arquivos de origem para garantir backup completo...';
    this.cdr.detectChanges();

    this.featuresService.startBackupAsync(this.backupDestination.trim(), selected).subscribe({
      next: (startRes) => {
        this.jobPolling.pollJob(startRes.data.job_id)
          .pipe(finalize(() => { this.loadingBackupRun = false; this.cdr.detectChanges(); }))
          .subscribe({
            next: (job) => {
              this.backupProgress = job.progress;
              this.backupProgressMsg = job.message;
              this.backupProgressEta = job.eta_text || '';
              if (job.status === 'completed' && job.result) {
                this.backupRunResult = job.result;
              } else if (job.status === 'failed') {
                this.dialog.open(ConfirmDialogComponent, {
                  width: '420px',
                  disableClose: true,
                  data: {
                    title: 'Erro ao Gerar Backup (.tar)',
                    message: job.error || 'Falha ao compactar pastas em .tar.',
                    type: 'danger',
                    hideCancel: true
                  }
                });
              }
              this.cdr.detectChanges();
            },
            error: (err) => {
              this.dialog.open(ConfirmDialogComponent, {
                width: '420px',
                disableClose: true,
                data: {
                  title: 'Erro ao Gerar Backup (.tar)',
                  message: err.error?.error?.message || 'Falha ao acompanhar progresso do backup.',
                  type: 'danger',
                  hideCancel: true
                }
              });
            }
          });
      },
      error: (err) => {
        this.loadingBackupRun = false;
        this.dialog.open(ConfirmDialogComponent, {
          width: '420px',
          disableClose: true,
          data: {
            title: 'Erro ao Gerar Backup (.tar)',
            message: err.error?.error?.message || 'Falha ao iniciar backup em .tar.',
            type: 'danger',
            hideCancel: true
          }
        });
      }
    });
  }

  // --- RUNBOOKS & ATALHOS ---
  carregarRemoteIds(): void {
    this.featuresService.getRemoteIds().subscribe({
      next: (res) => { this.remoteIds = res.data; this.cdr.detectChanges(); }
    });
  }

  abrirFerramentaNativa(tool: string): void {
    this.featuresService.openNativeTool(tool).subscribe();
  }

  marcarPassoRunbook(step: { label: string; done: boolean }): void {
    step.done = !step.done;
    if (step.done) {
      this.featuresService.logSessionAction(`Checklist executado: ${step.label}`).subscribe();
    }
  }
}
