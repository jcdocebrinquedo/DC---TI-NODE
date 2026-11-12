import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServiceOrderInput {
  station_name: string;
  technician_name: string;
  user_name?: string;
  actions_performed: string[];
}

export interface ServiceOrderOutput {
  order_id: string;
  created_at_local: string;
  markdown_path: string;
  txt_path: string;
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

  generateOrder(input: ServiceOrderInput): Observable<{ ok: boolean; data: ServiceOrderOutput }> {
    return this.http.post<{ ok: boolean; data: ServiceOrderOutput }>(`${this.apiUrl}/generate`, input);
  }
}

