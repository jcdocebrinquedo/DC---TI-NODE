import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DiskSmartEntry {
  index: number;
  device_id: string;
  model: string;
  serial_number: string;
  interface_type: string;
  media_type: string;
  is_ssd: boolean;
  size_gb: number;
  wmi_status: string;
  predict_failure: boolean;
  temperature_celsius?: number;
  wear_level_percent?: number;
  power_on_hours?: number;
  reallocated_sectors?: number;
  trim_enabled_system: boolean;
  health_score: number;
  health_verdict: string;
}

export interface DiskSmartReport {
  disks: DiskSmartEntry[];
  overall_status: string;
  has_critical_failure: boolean;
  trim_enabled: boolean;
  summary_notes: string[];
  collected_at_local: string;
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly apiUrl = '/api/system/disks/smart';

  constructor(private http: HttpClient) {}

  getDisksSmart(): Observable<{ ok: boolean; data: DiskSmartReport }> {
    return this.http.get<{ ok: boolean; data: DiskSmartReport }>(this.apiUrl);
  }
}

