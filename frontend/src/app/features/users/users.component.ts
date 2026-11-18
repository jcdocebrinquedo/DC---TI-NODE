import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { UsersService, LocalUserInfo, LocalGroupInfo } from './users.service';
import { TabPreloaderService } from '../../core/services/tab-preloader.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatDialogModule],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css']
})
export class UsersComponent implements OnInit {
  users: LocalUserInfo[] = [];
  allGroups: LocalGroupInfo[] = [];
  selectedUser: LocalUserInfo | null = null;
  newUsername = '';
  newFullName = '';

  initialUserGroups = new Set<string>();
  selectedUserGroups = new Set<string>();

  loadingList = false;
  loadingUpdate = false;
  loadingGroups = false;
  savingGroups = false;
  deletingUser = false;

  constructor(
    private usersService: UsersService,
    private preloader: TabPreloaderService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const cached = this.preloader.getCachedData<{ first: LocalUserInfo[]; second: LocalGroupInfo[] }>('users');
    if (cached && cached.first && cached.second) {
      this.allGroups = cached.second;
      this.users = cached.first;
      if (this.users.length > 0) this.selecionarUsuario(this.users[0]);
      this.cdr.detectChanges();
    } else {
      this.carregarGruposDisponiveis();
      this.carregarUsuarios();
    }
  }

  carregarGruposDisponiveis(): void {
    this.usersService.listGroups().subscribe({
      next: (res) => {
        this.allGroups = res.data || [];
        this.cdr.detectChanges();
      }
    });
  }

  carregarUsuarios(preferredUsername?: string): void {
    this.loadingList = true;
    this.cdr.detectChanges();
    this.usersService.listUsers()
      .pipe(finalize(() => {
        this.loadingList = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.users = res.data || [];
          const match = preferredUsername
            ? this.users.find(u => u.username.toLowerCase() === preferredUsername.toLowerCase())
            : (this.selectedUser ? this.users.find(u => u.username === this.selectedUser?.username) : null);

          if (match) {
            this.selecionarUsuario(match);
          } else if (this.users.length > 0) {
            this.selecionarUsuario(this.users[0]);
          } else {
            this.selectedUser = null;
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Falha ao listar usuários locais:', err);
          this.cdr.detectChanges();
        }
      });
  }

  selecionarUsuario(u: LocalUserInfo): void {
    this.selectedUser = u;
    this.newUsername = u.username;
    this.newFullName = u.full_name;
    this.carregarGruposDoUsuario(u.username);
    this.cdr.detectChanges();
  }

  carregarGruposDoUsuario(username: string): void {
    this.loadingGroups = true;
    this.initialUserGroups.clear();
    this.selectedUserGroups.clear();
    this.cdr.detectChanges();

    this.usersService.getUserGroups(username)
      .pipe(finalize(() => { this.loadingGroups = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          const list = res.data || [];
          this.initialUserGroups = new Set(list);
          this.selectedUserGroups = new Set(list);
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      });
  }

  isGroupSelected(groupName: string): boolean {
    return this.selectedUserGroups.has(groupName);
  }

  toggleGroup(groupName: string): void {
    if (this.selectedUserGroups.has(groupName)) {
      this.selectedUserGroups.delete(groupName);
    } else {
      this.selectedUserGroups.add(groupName);
    }
  }

  get hasGroupChanges(): boolean {
    if (this.initialUserGroups.size !== this.selectedUserGroups.size) return true;
    for (const g of this.selectedUserGroups) {
      if (!this.initialUserGroups.has(g)) return true;
    }
    return false;
  }

  salvarAlteracoes(): void {
    if (!this.selectedUser) return;
    const target = this.selectedUser.username;
    const renamedTo = this.newUsername.trim();

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Confirmar Renomeação / Alteração',
        message: `Deseja salvar os novos dados da conta local <strong>${target}</strong>?`,
        confirmText: 'Salvar',
        type: 'confirm'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.loadingUpdate = true;
      this.cdr.detectChanges();

      this.usersService.updateUser(target, renamedTo, this.newFullName)
        .pipe(finalize(() => {
          this.loadingUpdate = false;
          this.cdr.detectChanges();
        }))
        .subscribe({
          next: (res) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '400px',
              disableClose: true,
              data: {
                title: 'Sucesso',
                message: 'Dados da conta de usuário atualizados com sucesso.',
                type: 'success',
                hideCancel: true
              }
            });
            this.carregarUsuarios(res.data?.new_name || renamedTo);
          },
          error: (err) => {
            this.cdr.detectChanges();
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Erro',
                message: err.error?.error?.message || 'Falha ao atualizar conta (requer Administrador).',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }

  salvarGrupos(): void {
    if (!this.selectedUser) return;
    const target = this.selectedUser.username;

    const added = [...this.selectedUserGroups].filter(g => !this.initialUserGroups.has(g));
    const removed = [...this.initialUserGroups].filter(g => !this.selectedUserGroups.has(g));

    const summaryLines: string[] = [];
    if (added.length > 0) summaryLines.push(`<strong>Adicionar aos grupos:</strong> ${added.join(', ')}`);
    if (removed.length > 0) summaryLines.push(`<strong>Remover dos grupos:</strong> ${removed.join(', ')}`);

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        title: 'Confirmar Alteração de Permissões (Grupos)',
        message: `Deseja alterar as associações de grupos do usuário <strong>${target}</strong>?<br><br>${summaryLines.join('<br>')}`,
        confirmText: 'Aplicar Permissões',
        type: 'warning'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.savingGroups = true;
      this.cdr.detectChanges();

      this.usersService.setUserGroups(target, [...this.selectedUserGroups])
        .pipe(finalize(() => { this.savingGroups = false; this.cdr.detectChanges(); }))
        .subscribe({
          next: (res) => {
            const current = res.data?.current_groups || [];
            this.initialUserGroups = new Set(current);
            this.selectedUserGroups = new Set(current);
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Permissões Atualizadas',
                message: `Associações de grupos de <strong>${target}</strong> atualizadas com sucesso.`,
                type: 'success',
                hideCancel: true
              }
            });
            this.cdr.detectChanges();
          },
          error: (err) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Erro ao Alterar Grupos',
                message: err.error?.error?.message || 'Não foi possível alterar os grupos (requer privilégios de Administrador).',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }

  isProtectedSystemAccount(u: LocalUserInfo | null): boolean {
    if (!u) return true;
    if (u.is_current_user) return true;
    const protectedNames = ['wdagutilityaccount', 'defaultaccount', 'guest', 'convidado', 'administrator', 'administrador'];
    return protectedNames.includes((u.username || '').trim().toLowerCase());
  }

  removerUsuario(): void {
    if (!this.selectedUser || this.isProtectedSystemAccount(this.selectedUser)) return;
    const target = this.selectedUser.username;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        title: 'Remover Usuário do Windows',
        message: `<strong>Atenção:</strong> Esta ação irá excluir permanentemente a conta local <strong>${target}</strong> do sistema operacional.<br><br>Deseja realmente remover este usuário?`,
        confirmText: 'Remover Usuário',
        type: 'danger'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.deletingUser = true;
      this.cdr.detectChanges();

      this.usersService.deleteUser(target)
        .pipe(finalize(() => { this.deletingUser = false; this.cdr.detectChanges(); }))
        .subscribe({
          next: () => {
            this.selectedUser = null;
            this.dialog.open(ConfirmDialogComponent, {
              width: '400px',
              disableClose: true,
              data: {
                title: 'Usuário Removido',
                message: `A conta <strong>${target}</strong> foi removida com sucesso.`,
                type: 'success',
                hideCancel: true
              }
            });
            this.carregarUsuarios();
          },
          error: (err) => {
            this.dialog.open(ConfirmDialogComponent, {
              width: '420px',
              disableClose: true,
              data: {
                title: 'Erro ao Remover Usuário',
                message: err.error?.error?.message || 'Não foi possível remover a conta (requer Administrador).',
                type: 'danger',
                hideCancel: true
              }
            });
          }
        });
    });
  }
}
