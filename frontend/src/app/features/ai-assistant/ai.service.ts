import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AiConfig {
  gatewayUrl: string;
  apiKey: string;
  provider: string;
  model: string;
  temperature: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ChatResponse {
  reply: string;
  usage?: any;
  messagesHistory?: ChatMessage[];
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private readonly apiUrl = '/api/ai';

  constructor(private http: HttpClient) {}

  getConfig(): Observable<{ ok: boolean; data: AiConfig }> {
    return this.http.get<{ ok: boolean; data: AiConfig }>(`${this.apiUrl}/config`);
  }

  saveConfig(config: Partial<AiConfig>): Observable<{ ok: boolean; data: AiConfig }> {
    return this.http.post<{ ok: boolean; data: AiConfig }>(`${this.apiUrl}/config`, config);
  }

  sendMessage(messages: ChatMessage[]): Observable<{ ok: boolean; data: ChatResponse }> {
    return this.http.post<{ ok: boolean; data: ChatResponse }>(`${this.apiUrl}/chat`, { messages });
  }

  getAdminStatus(): Observable<{ ok: boolean; data: { elevated: boolean; native_elevated: boolean; user_confirmed: boolean } }> {
    return this.http.get<{ ok: boolean; data: { elevated: boolean; native_elevated: boolean; user_confirmed: boolean } }>('/api/system/admin-check');
  }

  confirmAdmin(triggerWindowsUac: boolean = false): Observable<{ ok: boolean; data: { elevated: boolean; user_confirmed: boolean } }> {
    return this.http.post<{ ok: boolean; data: { elevated: boolean; user_confirmed: boolean } }>('/api/system/admin-confirm', { trigger_windows_uac: triggerWindowsUac });
  }

  toggleAdmin(): Observable<{ ok: boolean; data: { elevated: boolean; user_confirmed: boolean } }> {
    return this.http.post<{ ok: boolean; data: { elevated: boolean; user_confirmed: boolean } }>('/api/system/admin-toggle', {});
  }
}

