import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface OutlookAccountItem {
  slot: string;
  account_name: string;
  display_name: string;
  email: string;
  type: 'POP3' | 'IMAP';
  incoming_server: string;
  incoming_port: number;
  outgoing_server: string;
  outgoing_port: number;
  has_password: boolean;
}

export interface OutlookDataFileItem {
  key: string;
  name: string;
  file_path: string;
  size_mb: number;
  exists: boolean;
}

export interface OutlookProfileDetection {
  office_version: string;
  default_profile: string;
  profile_registry_path: string;
  existed_previously: boolean;
  accounts: OutlookAccountItem[];
  data_files: OutlookDataFileItem[];
}

export interface PstCandidate {
  filename: string;
  full_path: string;
  size_mb: number;
  size_bytes: number;
  modified_at: string;
  matches_email: boolean;
}

export interface OutlookConfigPayload {
  display_name: string;
  email_address: string;
  domain: string;
  password: string;
  account_type: 'Pop3' | 'Imap';
  incoming_server: string;
  incoming_port: number;
  incoming_use_ssl: boolean;
  outgoing_server: string;
  outgoing_port: number;
  outgoing_use_ssl: boolean;
  outgoing_require_auth: boolean;
  use_existing_pst: boolean;
  existing_pst_path?: string;
}

export interface OutlookConfigResult {
  office_version: string;
  profile_name: string;
  account_index_hex: string;
  store_index_hex: string;
  account_registry_path: string;
  data_store_path: string;
  pst_mode: 'linked_existing' | 'created_new';
  password_encrypted: boolean;
  autodiscover_xml_path: string;
  incoming_endpoint: string;
  outgoing_endpoint: string;
  configured_at_local: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmailService {
  private readonly apiUrl = '/api/email/outlook';

  constructor(private http: HttpClient) {}

  detectProfile(): Observable<{ ok: boolean; data: OutlookProfileDetection }> {
    return this.http.get<{ ok: boolean; data: OutlookProfileDetection }>(`${this.apiUrl}/detect`);
  }

  getPstCandidates(email: string = ''): Observable<{ ok: boolean; data: PstCandidate[] }> {
    const params = new HttpParams().set('email', email);
    return this.http.get<{ ok: boolean; data: PstCandidate[] }>(`${this.apiUrl}/pst-candidates`, { params });
  }

  testAuthentication(config: Partial<OutlookConfigPayload>): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>(`${this.apiUrl}/test-auth`, config);
  }

  configureEmail(config: OutlookConfigPayload): Observable<{ ok: boolean; data: OutlookConfigResult }> {
    return this.http.post<{ ok: boolean; data: OutlookConfigResult }>(`${this.apiUrl}/configure`, config);
  }

  deleteAccount(slot: string, deletePstFile: boolean = false): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>(`${this.apiUrl}/account/${slot}/delete`, {
      delete_pst_file: deletePstFile
    });
  }

  deleteDataFile(key: string, deletePstFile: boolean = false): Observable<{ ok: boolean; data: any }> {
    return this.http.post<{ ok: boolean; data: any }>(`${this.apiUrl}/data-file/${key}/delete`, {
      delete_pst_file: deletePstFile
    });
  }
}
