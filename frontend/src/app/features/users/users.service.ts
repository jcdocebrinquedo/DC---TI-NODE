import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LocalUserInfo {
  username: string;
  full_name: string;
  comment: string;
  is_current_user: boolean;
}

export interface UserRenameResult {
  previous_name: string;
  new_name: string;
  full_name_updated: boolean;
  username_updated: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  private readonly apiUrl = '/api/system/users';

  constructor(private http: HttpClient) {}

  listUsers(): Observable<{ ok: boolean; data: LocalUserInfo[] }> {
    return this.http.get<{ ok: boolean; data: LocalUserInfo[] }>(this.apiUrl);
  }

  updateUser(target_username: string, new_username?: string, new_full_name?: string): Observable<{ ok: boolean; data: UserRenameResult }> {
    return this.http.post<{ ok: boolean; data: UserRenameResult }>(`${this.apiUrl}/update`, {
      target_username,
      new_username,
      new_full_name
    });
  }
}

