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

export interface WindowsUpdateStatus {
  mode: 'ATIVO_PADRAO' | 'DESABILITADO_PARCIAL' | 'DESABILITADO_PERMANENTEMENTE';
  no_auto_update_policy: boolean;
  services: Array<{ name: string; status: string; start_type: string; reg_start: number | null }>;
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

  startSfcAsync(): Observable<{ ok: boolean; data: { job_id: string } }> {
    return this.http.post<{ ok: boolean; data: { job_id: string } }>(`${this.apiUrl}/sfc-async`, {});
  }

  runDism(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/dism`, {});
  }

  startDismAsync(): Observable<{ ok: boolean; data: { job_id: string } }> {
    return this.http.post<{ ok: boolean; data: { job_id: string } }>(`${this.apiUrl}/dism-async`, {});
  }

  runFullSuite(): Observable<{ ok: boolean; data: RepairReport }> {
    return this.http.post<{ ok: boolean; data: RepairReport }>(`${this.apiUrl}/full-suite`, {});
  }

  startFullSuiteAsync(): Observable<{ ok: boolean; data: { job_id: string } }> {
    return this.http.post<{ ok: boolean; data: { job_id: string } }>(`${this.apiUrl}/full-suite-async`, {});
  }

  createRestorePoint(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/restore-point`, {});
  }

  scheduleChkdsk(drive: string = 'C:'): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>(`${this.apiUrl}/chkdsk-schedule`, { drive });
  }

  getWindowsUpdateStatus(): Observable<{ ok: boolean; data: WindowsUpdateStatus }> {
    return this.http.get<{ ok: boolean; data: WindowsUpdateStatus }>('/api/windows-update/status');
  }

  repairWindowsUpdate(): Observable<{ ok: boolean; data: RepairTaskResult }> {
    return this.http.post<{ ok: boolean; data: RepairTaskResult }>('/api/windows-update/repair', {});
  }

  disableWindowsUpdatePermanently(): Observable<{ ok: boolean; data: { ok: boolean; message: string } }> {
    return this.http.post<{ ok: boolean; data: { ok: boolean; message: string } }>('/api/windows-update/disable-permanent', {});
  }

  enableWindowsUpdateDefault(): Observable<{ ok: boolean; data: { ok: boolean; message: string } }> {
    return this.http.post<{ ok: boolean; data: { ok: boolean; message: string } }>('/api/windows-update/enable', {});
  }
}
