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
  executed_at_local: string;
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
}

