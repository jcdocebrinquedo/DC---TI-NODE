import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServiceOrderInput {
  station_name: string;
  technician_name: string;
  user_name?: string;
  summary?: string;
  actions_performed: string[];
}

export interface ServiceOrderOutput {
  order_id: string;
  created_at_local: string;
  station_name?: string;
  technician_name?: string;
  user_name?: string;
  summary?: string;
  actions_performed?: string[];
  markdown_path: string;
  txt_path: string;
  docx_path: string;
  pdf_path: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServiceOrderService {
  private readonly apiUrl = '/api/service-order';

  constructor(private http: HttpClient) {}

  getSession(): Observable<{ ok: boolean; data: { stationName: string; actions: Array<{ timestamp: string; description: string }> } }> {
    return this.http.get<{ ok: boolean; data: { stationName: string; actions: Array<{ timestamp: string; description: string }> } }>(`${this.apiUrl}/session`);
  }

  clearSession(): Observable<{ ok: boolean; data: { stationName: string; actions: any[] } }> {
    return this.http.post<{ ok: boolean; data: { stationName: string; actions: any[] } }>(`${this.apiUrl}/session/clear`, {});
  }

  generateOrder(input: ServiceOrderInput): Observable<{ ok: boolean; data: ServiceOrderOutput }> {
    return this.http.post<{ ok: boolean; data: ServiceOrderOutput }>(`${this.apiUrl}/generate`, input);
  }

  generateAiSummary(actions: string[], stationName: string): Observable<{ ok: boolean; data: { summary: string; used_ai: boolean } }> {
    return this.http.post<{ ok: boolean; data: { summary: string; used_ai: boolean } }>(`${this.apiUrl}/ai-summary`, {
      actions,
      station_name: stationName
    });
  }

  getHistory(): Observable<{ ok: boolean; data: ServiceOrderOutput[] }> {
    return this.http.get<{ ok: boolean; data: ServiceOrderOutput[] }>(`${this.apiUrl}/history`);
  }

  restoreFromHistory(orderId: string): Observable<{ ok: boolean; data: ServiceOrderOutput }> {
    return this.http.post<{ ok: boolean; data: ServiceOrderOutput }>(`${this.apiUrl}/history/${encodeURIComponent(orderId)}/restore`, {});
  }

  deleteFromHistory(orderId: string): Observable<{ ok: boolean; data: { deleted: boolean } }> {
    return this.http.delete<{ ok: boolean; data: { deleted: boolean } }>(`${this.apiUrl}/history/${encodeURIComponent(orderId)}`);
  }

  openFile(filePath: string): Observable<{ ok: boolean; data: { opened: string } }> {
    return this.http.post<{ ok: boolean; data: { opened: string } }>(`${this.apiUrl}/open-file`, { path: filePath });
  }

  openFolder(): Observable<{ ok: boolean; data: { folder: string } }> {
    return this.http.post<{ ok: boolean; data: { folder: string } }>(`${this.apiUrl}/open-folder`, {});
  }
}
