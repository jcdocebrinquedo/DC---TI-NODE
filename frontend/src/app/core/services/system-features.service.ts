import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NetworkDiagnostics {
  interfaces: Array<{ name: string; ip: string; netmask: string; mac: string }>;
  gateway_ip?: string | null;
  configs?: Array<{ interface_alias: string; gateway: string | null; dns_servers: string[] }>;
  mapped_drives?: Array<{ drive: string; provider_name: string; volume_name: string }>;
  tests: Array<{ target: string; host: string; reachable: boolean; latency_ms: number }>;
  tcp_ports?: Array<{ label: string; host: string; port: number; open: boolean; latency_ms: number }>;
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
  registry_path?: string;
  task_path?: string;
  kind?: 'registry' | 'file' | 'task';
}

export interface CrashReport {
  has_dumps: boolean;
  dump_files: Array<{ file_name: string; size_kb: number; created_at: string }>;
  critical_events: Array<{ time: string; id: number; message: string }>;
  bugchecks?: Array<{ time: string; provider: string; message: string }>;
}

export interface StressTestResult {
  success: boolean;
  duration_seconds: number;
  cpu_cores_tested: number;
  operations_completed: number;
  temp_before_c?: number | null;
  temp_after_c?: number | null;
  stability: string;
}

export interface BackupEstimate {
  total_size_gb?: string;
  folders: Array<{ key?: string; folder: string; path: string; files_count: number; size_mb: string }>;
}

export interface DriverItem {
  device_name: string;
  device_class: string;
  manufacturer: string;
  driver_version: string;
  driver_date: string;
  inf_name: string;
  hardware_id: string;
  device_id: string;
  error_code: number;
  has_error: boolean;
}

export interface DriverScanResult {
  system_manufacturer: string;
  system_model: string;
  total: number;
  errors_count: number;
  drivers: DriverItem[];
}

export interface DriverUpdateItem {
  update_id: string;
  title: string;
  driver_class: string;
  driver_manufacturer: string;
  driver_model: string;
  driver_provider: string;
  driver_ver_date: string;
  size_mb: number;
  is_downloaded: boolean;
  reboot_required: boolean;
}

export interface WingetPackage {
  name: string;
  id: string;
  version: string;
  available_version: string;
  source: string;
}

export interface PrinterItem {
  name: string;
  driver_name: string;
  port_name: string;
  printer_status: string;
  shared: boolean;
  is_default: boolean;
  jobs_count: number;
  type: string;
}

export interface SystemInventory {
  collected_at_local: string;
  system_manufacturer: string;
  system_model: string;
  serial_number: string;
  bios_version: string;
  motherboard: string;
  os_caption: string;
  os_version: string;
  windows_license?: { name: string; partial_key: string; status: string } | null;
  ram_total_slots: number;
  ram_modules: Array<{ slot: string; manufacturer: string; part_number: string; capacity_gb: number; speed_mhz: number }>;
  gpus: Array<{ name: string; driver_version: string; vram_mb: number }>;
}

export interface InstalledSoftwareItem {
  name: string;
  version: string;
  publisher: string;
  install_date: string;
  install_location?: string;
  reg_key_path?: string;
  uninstall_string: string;
  quiet_uninstall?: string;
}

export interface RemoteAccessIds {
  anydesk: string | null;
  rustdesk: string | null;
  teamviewer: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class SystemFeaturesService {
  constructor(private http: HttpClient) {}

  getNetworkDoctor(): Observable<{ ok: boolean; data: NetworkDiagnostics }> {
    return this.http.get<{ ok: boolean; data: NetworkDiagnostics }>('/api/network/doctor');
  }

  renewDhcp(): Observable<{ ok: boolean; data: { ok: boolean; message: string; output: string } }> {
    return this.http.post<{ ok: boolean; data: { ok: boolean; message: string; output: string } }>('/api/network/dhcp-renew', {});
  }

  getSecurityAudit(): Observable<{ ok: boolean; data: SecurityAudit }> {
    return this.http.get<{ ok: boolean; data: SecurityAudit }>('/api/security/audit');
  }

  getStartupPrograms(): Observable<{ ok: boolean; data: StartupProgram[] }> {
    return this.http.get<{ ok: boolean; data: StartupProgram[] }>('/api/startup/list');
  }

  removeStartupProgram(item: StartupProgram): Observable<{ ok: boolean; data: { ok: boolean; message: string } }> {
    return this.http.post<{ ok: boolean; data: { ok: boolean; message: string } }>('/api/startup/remove', item);
  }

  getCrashReports(): Observable<{ ok: boolean; data: CrashReport }> {
    return this.http.get<{ ok: boolean; data: CrashReport }>('/api/helpdesk/crashes');
  }

  runStressTest(durationSeconds: number = 10): Observable<{ ok: boolean; data: StressTestResult }> {
    return this.http.post<{ ok: boolean; data: StressTestResult }>('/api/helpdesk/stress-test', { duration: durationSeconds });
  }

  stopStressTest(): Observable<{ ok: boolean; data: { stopped: number } }> {
    return this.http.post<{ ok: boolean; data: { stopped: number } }>('/api/helpdesk/stress-test/stop', {});
  }

  getBackupEstimate(): Observable<{ ok: boolean; data: BackupEstimate }> {
    return this.http.get<{ ok: boolean; data: BackupEstimate }>('/api/helpdesk/backup-estimate');
  }

  runBackup(destination: string, folders: string[]): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/helpdesk/backup-run', { destination, folders });
  }

  startBackupAsync(destination: string, folders: string[]): Observable<{ ok: boolean; data: { job_id: string } }> {
    return this.http.post<{ ok: boolean; data: { job_id: string } }>('/api/helpdesk/backup-run-async', { destination, folders });
  }

  scanDrivers(): Observable<{ ok: boolean; data: DriverScanResult }> {
    return this.http.get<{ ok: boolean; data: DriverScanResult }>('/api/drivers/scan');
  }

  checkDriverUpdates(): Observable<{ ok: boolean; data: { ok: boolean; count: number; updates: DriverUpdateItem[]; error?: string } }> {
    return this.http.get<{ ok: boolean; data: { ok: boolean; count: number; updates: DriverUpdateItem[]; error?: string } }>('/api/drivers/updates');
  }

  installDriverUpdate(payload: { update_id?: string; inf_path?: string; title?: string }): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/drivers/install', payload);
  }

  openExternalDriverPage(payload: { manufacturer?: string; hardwareId?: string; systemManufacturer?: string; deviceName?: string; url?: string }): Observable<{ ok: boolean; data: { opened: string } }> {
    return this.http.post<{ ok: boolean; data: { opened: string } }>('/api/drivers/open-external', payload);
  }

  getWingetUpdates(): Observable<{ ok: boolean; data: { available: boolean; packages: WingetPackage[]; output: string } }> {
    return this.http.get<{ ok: boolean; data: { available: boolean; packages: WingetPackage[]; output: string } }>('/api/software/winget-updates');
  }

  upgradeWingetPackage(packageId: string): Observable<{ ok: boolean; data: { ok: boolean; package_id: string; output: string } }> {
    return this.http.post<{ ok: boolean; data: { ok: boolean; package_id: string; output: string } }>('/api/software/winget-upgrade', { package_id: packageId });
  }

  startWingetUpgradeAsync(packageId: string, packageIds: string[] = []): Observable<{ ok: boolean; data: { job_id: string } }> {
    return this.http.post<{ ok: boolean; data: { job_id: string } }>('/api/software/winget-upgrade-async', {
      package_id: packageId,
      package_ids: packageIds
    });
  }

  listPrinters(): Observable<{ ok: boolean; data: PrinterItem[] }> {
    return this.http.get<{ ok: boolean; data: PrinterItem[] }>('/api/printers');
  }

  clearPrinterQueue(name: string): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/printers/clear-queue', { name });
  }

  setDefaultPrinter(name: string): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/printers/set-default', { name });
  }

  printTestPage(name: string): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/printers/test-page', { name });
  }

  getFullInventory(): Observable<{ ok: boolean; data: SystemInventory }> {
    return this.http.get<{ ok: boolean; data: SystemInventory }>('/api/system/inventory');
  }

  listInstalledSoftware(): Observable<{ ok: boolean; data: InstalledSoftwareItem[] }> {
    return this.http.get<{ ok: boolean; data: InstalledSoftwareItem[] }>('/api/software/installed');
  }

  uninstallSoftware(item: InstalledSoftwareItem, deep: boolean = false): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/software/uninstall', { ...item, deep });
  }

  uninstallMultipleSoftware(items: InstalledSoftwareItem[], deep: boolean = false): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/software/uninstall-batch', { items, deep });
  }

  getRemoteIds(): Observable<{ ok: boolean; data: RemoteAccessIds }> {
    return this.http.get<{ ok: boolean; data: RemoteAccessIds }>('/api/helpdesk/remote-ids');
  }

  openNativeTool(tool: string): Observable<{ ok: boolean; data: { launched: string } }> {
    return this.http.post<{ ok: boolean; data: { launched: string } }>('/api/helpdesk/native-tool', { tool });
  }

  logSessionAction(description: string): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>('/api/service-order/session/add-action', { description });
  }
}
