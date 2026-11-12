import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { RepairService, RepairReport, RepairTaskResult } from './repair.service';

@Component({
  selector: 'app-repair',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './repair.component.html',
  styleUrls: ['./repair.component.css']
})
export class RepairComponent {
  runningTask: string | null = null;
  tasks: RepairTaskResult[] = [];
  report: RepairReport | null = null;

  constructor(
    private repairService: RepairService,
    private cdr: ChangeDetectorRef
  ) {}

  executarSpooler(): void {
    this.runningTask = 'spooler';
    this.cdr.detectChanges();
    this.repairService.runSpooler()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); }
      });
  }

  executarNetwork(): void {
    this.runningTask = 'network';
    this.cdr.detectChanges();
    this.repairService.runNetwork()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); }
      });
  }

  executarSfc(): void {
    this.runningTask = 'sfc';
    this.cdr.detectChanges();
    this.repairService.runSfc()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); }
      });
  }

  executarDism(): void {
    this.runningTask = 'dism';
    this.cdr.detectChanges();
    this.repairService.runDism()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => { this.tasks.unshift(res.data); this.cdr.detectChanges(); }
      });
  }

  executarSuiteCompleta(): void {
    this.runningTask = 'suite';
    this.cdr.detectChanges();
    this.repairService.runFullSuite()
      .pipe(finalize(() => { this.runningTask = null; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.report = res.data;
          this.tasks = res.data.tasks;
          this.cdr.detectChanges();
        }
      });
  }
}

