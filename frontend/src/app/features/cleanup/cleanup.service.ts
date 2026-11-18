import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CleanupReport {
  directories_targeted: string[];
  files_removed: number;
  folders_removed: number;
  locked_items_skipped: number;
  bytes_freed: number;
  megabytes_freed: number;
  dns_flushed: boolean;
  winsxs_cleaned?: boolean;
  executed_at_local: string;
}

export interface StorageAnalysis {
  drive: string;
  analyzed_at_local: string;
  folders: Array<{ label: string; path: string; size_mb: number; size_gb: number }>;
}

@Injectable({
  providedIn: 'root'
})
export class CleanupService {
  private readonly apiUrl = '/api/cleanup/deep';

  constructor(private http: HttpClient) {}

  runCleanup(options: any = {}): Observable<{ ok: boolean; data: CleanupReport }> {
    return this.http.post<{ ok: boolean; data: CleanupReport }>(this.apiUrl, options);
  }

  analyzeStorage(drive: string = 'C:\\'): Observable<{ ok: boolean; data: StorageAnalysis }> {
    return this.http.get<{ ok: boolean; data: StorageAnalysis }>(`/api/storage/analyze?drive=${encodeURIComponent(drive)}`);
  }
}
