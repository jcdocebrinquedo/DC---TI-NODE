import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SmartRecommendation {
  severity: string;
  component: string;
  issue: string;
  action: string;
}

export interface VolumeSpaceInfo {
  mount_point: string;
  name: string;
  file_system: string;
  total_gb: number;
  available_gb: number;
  used_gb: number;
  used_percent: number;
  is_removable: boolean;
}

export interface HardwareConfigReport {
  hostname: string;
  os_edition: string;
  os_display_version: string;
  os_build: string;
  architecture: string;
  uptime_hours: number;
  cpu_brand: string;
  cpu_physical_cores: number;
  cpu_logical_cores: number;
  cpu_usage_percent: number;
  ram_total_gb: number;
  ram_used_gb: number;
  ram_available_gb: number;
  ram_usage_percent: number;
  swap_total_gb: number;
  swap_used_gb: number;
  motherboard_manufacturer: string;
  motherboard_product: string;
  bios_version: string;
  gpu_models: string[];
  volumes: VolumeSpaceInfo[];
}

export interface FullDiagnosticReport {
  generated_at_local: string;
  machine_score: number;
  score_classification: string;
  hardware: HardwareConfigReport;
  disk_smart: any;
  battery: any;
  shutdown_analysis: any;
  recommendations: SmartRecommendation[];
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private readonly apiUrl = '/api/diagnostic/full';

  constructor(private http: HttpClient) {}

  getFullDiagnostic(): Observable<{ ok: boolean; data: FullDiagnosticReport }> {
    return this.http.get<{ ok: boolean; data: FullDiagnosticReport }>(this.apiUrl);
  }
}

