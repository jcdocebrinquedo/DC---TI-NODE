import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { UsersService, LocalUserInfo } from './users.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css']
})
export class UsersComponent implements OnInit {
  users: LocalUserInfo[] = [];
  selectedUser: LocalUserInfo | null = null;
  newUsername = '';
  newFullName = '';
  loadingList = false;
  loadingUpdate = false;

  constructor(
    private usersService: UsersService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregarUsuarios();
  }

  carregarUsuarios(): void {
    this.loadingList = true;
    this.cdr.detectChanges();
    this.usersService.listUsers()
      .pipe(finalize(() => {
        this.loadingList = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.users = res.data;
          if (this.users.length > 0 && !this.selectedUser) {
            this.selecionarUsuario(this.users[0]);
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
    this.cdr.detectChanges();
  }

  salvarAlteracoes(): void {
    if (!this.selectedUser) return;
    const target = this.selectedUser.username;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: 'Confirmar Alteração de Conta',
        message: `Deseja atualizar a conta local <strong>${target}</strong>?`,
        confirmText: 'Salvar',
        type: 'confirm'
      }
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.loadingUpdate = true;
      this.cdr.detectChanges();

      this.usersService.updateUser(target, this.newUsername, this.newFullName)
        .pipe(finalize(() => {
          this.loadingUpdate = false;
          this.cdr.detectChanges();
        }))
        .subscribe({
          next: () => {
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
            this.carregarUsuarios();
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
}

