import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RepairTaskResult {
  task_name: string;
  command: string;
  exit_code: number;
  output_summary: string;
  success: boolean;
  duration_seconds: number;
}

export interface RepairReport {
  executed_at_local: string;
  tasks: RepairTaskResult[];
  overall_success: boolean;
  requires_reboot: boolean;
  summary_notes: string[];
}

@Injectable({
  providedIn: 'root'
})
export class RepairService {
  private readonly apiUrl = '/api/repair';

  constructor(private http: HttpClient) {}

  runSpooler(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/spooler`, {});
  }

  runNetwork(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/network`, {});
  }

  runSfc(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/sfc`, {});
  }

  runDism(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/dism`, {});
  }

  runFullSuite(): Observable<{ ok: boolean; data: RepairReport }> {
    return this.http.post<{ ok: boolean; data: RepairReport }>(`${this.apiUrl}/full-suite`, {});
  }
}

