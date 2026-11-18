import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, of } from 'rxjs';

export type TabLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TabLoadState {
  status: TabLoadStatus;
  progress: number;
  data: any;
}

@Injectable({
  providedIn: 'root'
})
export class TabPreloaderService {
  private states = new Map<string, TabLoadState>();
  private timers = new Map<string, any>();
  private started = false;

  readonly stateChanged$ = new BehaviorSubject<number>(0);

  constructor(private http: HttpClient) {
    const keys = [
      'dashboard', 'hostname', 'users', 'storage', 'repair', 'toolkit', 'service-order',
      'tk:network', 'tk:printers', 'tk:winget', 'tk:inventory', 'tk:startup', 'tk:crashes', 'tk:backup', 'tk:runbooks'
    ];
    for (const k of keys) {
      this.states.set(k, { status: 'idle', progress: 0, data: null });
    }
  }

  getState(key: string): TabLoadState {
    return this.states.get(key) || { status: 'ready', progress: 100, data: null };
  }

  isLoading(key: string): boolean {
    return this.getState(key).status === 'loading';
  }

  getProgress(key: string): number {
    return this.getState(key).progress;
  }

  getCachedData<T = any>(key: string): T | null {
    const st = this.states.get(key);
    return st && st.status === 'ready' ? (st.data as T) : null;
  }

  setReadyData(key: string, data: any): void {
    this.stopTimer(key);
    this.states.set(key, { status: 'ready', progress: 100, data });
    this.notify();
  }

  startPreloadAll(): void {
    if (this.started) return;
    this.started = true;

    // Marca todas as abas pré-carregáveis como 'loading' imediatamente para bloquear abertura prematura
    const preloadJobs: Array<{ key: string; delayMs: number; loader: () => void }> = [
      { key: 'hostname', delayMs: 80, loader: () => this.fetchOne('hostname', '/api/system/hostname') },
      { key: 'service-order', delayMs: 120, loader: () => this.fetchPair('service-order', '/api/service-order/session', '/api/service-order/history') },
      { key: 'storage', delayMs: 250, loader: () => this.fetchOne('storage', '/api/system/disks/smart') },
      { key: 'users', delayMs: 400, loader: () => this.fetchPair('users', '/api/system/users', '/api/system/users/groups') },
      { key: 'repair', delayMs: 550, loader: () => this.fetchOne('repair', '/api/windows-update/status') },
      { key: 'dashboard', delayMs: 700, loader: () => this.fetchOne('dashboard', '/api/diagnostic/full') },

      // Sub-tabs do Toolkit (carregam em segundo plano com barra individual)
      { key: 'tk:network', delayMs: 900, loader: () => this.fetchToolkitTab('tk:network', '/api/network/doctor') },
      { key: 'tk:printers', delayMs: 1100, loader: () => this.fetchToolkitTab('tk:printers', '/api/printers') },
      { key: 'tk:startup', delayMs: 1300, loader: () => this.fetchToolkitTab('tk:startup', '/api/startup/list') },
      { key: 'tk:crashes', delayMs: 1500, loader: () => this.fetchToolkitTab('tk:crashes', '/api/helpdesk/crashes') },
      { key: 'tk:runbooks', delayMs: 1700, loader: () => this.fetchToolkitTab('tk:runbooks', '/api/helpdesk/remote-ids') },
      { key: 'tk:backup', delayMs: 1900, loader: () => this.fetchToolkitTab('tk:backup', '/api/helpdesk/backup-estimate') },
      { key: 'tk:inventory', delayMs: 2200, loader: () => this.fetchPair('tk:inventory', '/api/system/inventory', '/api/software/installed', 'toolkit') },
      { key: 'tk:winget', delayMs: 2600, loader: () => this.fetchToolkitTab('tk:winget', '/api/software/winget-updates') }
    ];

    for (const job of preloadJobs) {
      this.markLoading(job.key);
      setTimeout(() => job.loader(), job.delayMs);
    }
    this.markLoading('toolkit');
  }

  private markLoading(key: string): void {
    this.stopTimer(key);
    this.states.set(key, { status: 'loading', progress: 8, data: null });
    const timer = setInterval(() => {
      const cur = this.states.get(key);
      if (!cur || cur.status !== 'loading') {
        this.stopTimer(key);
        return;
      }
      if (cur.progress < 88) {
        const step = cur.progress < 50 ? 9 : 4;
        cur.progress = Math.min(88, cur.progress + step);
        this.notify();
      }
    }, 350);
    this.timers.set(key, timer);
    this.notify();
  }

  private stopTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) {
      clearInterval(t);
      this.timers.delete(key);
    }
  }

  private notify(): void {
    this.stateChanged$.next(this.stateChanged$.value + 1);
  }

  private fetchOne(key: string, url: string): void {
    this.http.get<{ ok: boolean; data: any }>(url)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.stopTimer(key))
      )
      .subscribe((res) => {
        if (res && res.ok) {
          this.states.set(key, { status: 'ready', progress: 100, data: res.data });
        } else {
          this.states.set(key, { status: 'error', progress: 100, data: null });
        }
        this.notify();
      });
  }

  private fetchToolkitTab(key: string, url: string): void {
    this.http.get<{ ok: boolean; data: any }>(url)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.stopTimer(key))
      )
      .subscribe((res) => {
        if (res && res.ok) {
          this.states.set(key, { status: 'ready', progress: 100, data: res.data });
        } else {
          this.states.set(key, { status: 'error', progress: 100, data: null });
        }
        this.updateToolkitAggregateState();
        this.notify();
      });
  }

  private fetchPair(key: string, urlA: string, urlB: string, aggregateToolkit?: string): void {
    let doneA = false;
    let doneB = false;
    let dataA: any = null;
    let dataB: any = null;

    const checkFinish = () => {
      if (doneA && doneB) {
        this.stopTimer(key);
        this.states.set(key, { status: 'ready', progress: 100, data: { first: dataA, second: dataB } });
        if (aggregateToolkit) this.updateToolkitAggregateState();
        this.notify();
      }
    };

    this.http.get<{ ok: boolean; data: any }>(urlA).pipe(catchError(() => of(null))).subscribe(r => {
      dataA = r?.data ?? null;
      doneA = true;
      checkFinish();
    });

    this.http.get<{ ok: boolean; data: any }>(urlB).pipe(catchError(() => of(null))).subscribe(r => {
      dataB = r?.data ?? null;
      doneB = true;
      checkFinish();
    });
  }

  private updateToolkitAggregateState(): void {
    const subKeys = ['tk:network', 'tk:printers', 'tk:winget', 'tk:inventory', 'tk:startup', 'tk:crashes', 'tk:backup', 'tk:runbooks'];
    const states = subKeys.map(k => this.getState(k));
    const avgProgress = Math.round(states.reduce((acc, s) => acc + s.progress, 0) / subKeys.length);
    const anyLoading = states.some(s => s.status === 'loading');
    // Libera a aba principal do Toolkit assim que a primeira sub-aba (Network) estiver pronta!
    const networkReady = this.getState('tk:network').status !== 'loading';

    if (networkReady && !anyLoading) {
      this.stopTimer('toolkit');
      this.states.set('toolkit', { status: 'ready', progress: 100, data: true });
    } else if (networkReady) {
      this.stopTimer('toolkit');
      this.states.set('toolkit', { status: 'ready', progress: avgProgress, data: true });
    } else {
      const cur = this.getState('toolkit');
      cur.progress = Math.max(cur.progress, avgProgress);
    }
  }
}
