import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { StorageService, DiskSmartReport } from './storage.service';

@Component({
  selector: 'app-storage',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './storage.component.html',
  styleUrls: ['./storage.component.css']
})
export class StorageComponent implements OnInit {
  report: DiskSmartReport | null = null;
  loading = false;

  constructor(
    private storageService: StorageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregarDiscos();
  }

  carregarDiscos(): void {
    this.loading = true;
    this.cdr.detectChanges();
    this.storageService.getDisksSmart()
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
          console.error('Falha ao obter dados SMART:', err);
          this.cdr.detectChanges();
        }
      });
  }
}

