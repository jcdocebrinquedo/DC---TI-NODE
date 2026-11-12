import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface HostnameInfo {
  active_name: string;
  configured_name: string;
  tcpip_hostname: string;
  nv_hostname: string;
  domain: string;
  pending_reboot_change: boolean;
}

export interface HostnameChangeResult {
  previous_name: string;
  new_name: string;
  registry_updated: boolean;
  win32_api_updated: boolean;
  reboot_required: boolean;
  changed_at_local: string;
}

@Injectable({
  providedIn: 'root'
})
export class HostnameService {
  private readonly apiUrl = '/api/system/hostname';

  constructor(private http: HttpClient) {}

  getInfo(): Observable<{ ok: boolean; data: HostnameInfo }> {
    return this.http.get<{ ok: boolean; data: HostnameInfo }>(this.apiUrl);
  }

  setHostname(name: string): Observable<{ ok: boolean; data: HostnameChangeResult }> {
    return this.http.post<{ ok: boolean; data: HostnameChangeResult }>(this.apiUrl, { name });
  }
}

