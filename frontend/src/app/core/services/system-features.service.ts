import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NetworkDiagnostics {
  interfaces: Array<{ name: string; ip: string; netmask: string; mac: string }>;
  tests: Array<{ target: string; host: string; reachable: boolean; latency_ms: number }>;
  dns_resolution: { domain: string; reachable: boolean; ips: string[]; latency_ms?: number; error?: string };
  internet_active: boolean;
}

export interface SecurityAudit {
  defender_active: boolean;
  defender_updated: boolean;
  firewall_active: boolean;
  bitlocker_status: string;
}

export interface StartupProgram {
  name: string;
  command: string;
  location: string;
}

export interface CrashReport {
  has_dumps: boolean;
  dump_files: Array<{ file_name: string; size_kb: number; created_at: string }>;
  critical_events: Array<{ time: string; id: number; message: string }>;
}

export interface StressTestResult {
  success: boolean;
  duration_seconds: number;
  cpu_cores_tested: number;
  operations_completed: number;
  stability: string;
}

export interface BackupEstimate {
  user_profile: string;
  folders: Array<{ folder: string; path: string; files_count: number; size_mb: string }>;
}

@Injectable({
  providedIn: 'root'
})
export class SystemFeaturesService {
  constructor(private http: HttpClient) {}

  getNetworkDoctor(): Observable<{ ok: boolean; data: NetworkDiagnostics }> {
    return this.http.get<{ ok: boolean; data: NetworkDiagnostics }>('/api/network/doctor');
  }

  getSecurityAudit(): Observable<{ ok: boolean; data: SecurityAudit }> {
    return this.http.get<{ ok: boolean; data: SecurityAudit }>('/api/security/audit');
  }

  getStartupPrograms(): Observable<{ ok: boolean; data: StartupProgram[] }> {
    return this.http.get<{ ok: boolean; data: StartupProgram[] }>('/api/startup/list');
  }

  getCrashReports(): Observable<{ ok: boolean; data: CrashReport }> {
    return this.http.get<{ ok: boolean; data: CrashReport }>('/api/helpdesk/crashes');
  }

  runStressTest(durationSeconds: number = 10): Observable<{ ok: boolean; data: StressTestResult }> {
    return this.http.post<{ ok: boolean; data: StressTestResult }>('/api/helpdesk/stress-test', { duration: durationSeconds });
  }

  getBackupEstimate(): Observable<{ ok: boolean; data: BackupEstimate }> {
    return this.http.get<{ ok: boolean; data: BackupEstimate }>('/api/helpdesk/backup-estimate');
  }
}

