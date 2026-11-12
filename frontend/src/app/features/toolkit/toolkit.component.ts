import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs/operators';
import {
  SystemFeaturesService,
  NetworkDiagnostics,
  SecurityAudit,
  StartupProgram,
  CrashReport,
  StressTestResult,
  BackupEstimate
} from '../../core/services/system-features.service';

@Component({
  selector: 'app-toolkit',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './toolkit.component.html',
  styleUrls: ['./toolkit.component.css']
})
export class ToolkitComponent implements OnInit {
  activeTab: 'network' | 'security' | 'startup' | 'crashes' | 'stress' | 'backup' = 'network';

  // Estados de dados
  networkData: NetworkDiagnostics | null = null;
  securityData: SecurityAudit | null = null;
  startupList: StartupProgram[] = [];
  crashData: CrashReport | null = null;
  stressResult: StressTestResult | null = null;
  backupData: BackupEstimate | null = null;

  // Loadings
  loadingNetwork = false;
  loadingSecurity = false;
  loadingStartup = false;
  loadingCrashes = false;
  loadingStress = false;
  loadingBackup = false;

  constructor(
    private featuresService: SystemFeaturesService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregarNetwork();
  }

  setTab(tab: 'network' | 'security' | 'startup' | 'crashes' | 'stress' | 'backup'): void {
    this.activeTab = tab;
    if (tab === 'network' && !this.networkData) this.carregarNetwork();
    if (tab === 'security' && !this.securityData) this.carregarSecurity();
    if (tab === 'startup' && this.startupList.length === 0) this.carregarStartup();
    if (tab === 'crashes' && !this.crashData) this.carregarCrashes();
    if (tab === 'backup' && !this.backupData) this.carregarBackup();
  }

  carregarNetwork(): void {
    this.loadingNetwork = true;
    this.cdr.detectChanges();
    this.featuresService.getNetworkDoctor()
      .pipe(finalize(() => { this.loadingNetwork = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.networkData = res.data; this.cdr.detectChanges(); }
      });
  }

  carregarSecurity(): void {
    this.loadingSecurity = true;
    this.cdr.detectChanges();
    this.featuresService.getSecurityAudit()
      .pipe(finalize(() => { this.loadingSecurity = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.securityData = res.data; this.cdr.detectChanges(); }
      });
  }

  carregarStartup(): void {
    this.loadingStartup = true;
    this.cdr.detectChanges();
    this.featuresService.getStartupPrograms()
      .pipe(finalize(() => { this.loadingStartup = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.startupList = res.data; this.cdr.detectChanges(); }
      });
  }

  carregarCrashes(): void {
    this.loadingCrashes = true;
    this.cdr.detectChanges();
    this.featuresService.getCrashReports()
      .pipe(finalize(() => { this.loadingCrashes = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.crashData = res.data; this.cdr.detectChanges(); }
      });
  }

  executarStressTest(): void {
    this.loadingStress = true;
    this.stressResult = null;
    this.cdr.detectChanges();
    this.featuresService.runStressTest(10)
      .pipe(finalize(() => { this.loadingStress = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.stressResult = res.data; this.cdr.detectChanges(); }
      });
  }

  carregarBackup(): void {
    this.loadingBackup = true;
    this.cdr.detectChanges();
    this.featuresService.getBackupEstimate()
      .pipe(finalize(() => { this.loadingBackup = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.backupData = res.data; this.cdr.detectChanges(); }
      });
  }
}

