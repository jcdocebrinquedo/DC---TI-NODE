import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, startWith, switchMap, map, takeWhile } from 'rxjs';

export interface JobStatus<T = any> {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  eta_text?: string;
  result: T | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class JobPollingService {
  constructor(private http: HttpClient) {}

  pollJob<T = any>(jobId: string, intervalMs: number = 800): Observable<JobStatus<T>> {
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() => this.http.get<{ ok: boolean; data: JobStatus<T> }>(`/api/jobs/${encodeURIComponent(jobId)}`)),
      map(res => res.data),
      takeWhile(job => job.status === 'running', true)
    );
  }
}
