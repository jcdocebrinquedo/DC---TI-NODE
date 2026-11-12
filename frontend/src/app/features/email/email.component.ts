import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import {
  EmailService,
  OutlookProfileDetection,
  OutlookConfigResult,
  PstCandidate,
  OutlookConfigPayload
} from './email.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-email',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule],
  templateUrl: './email.component.html',
  styleUrls: ['./email.component.css']
})
export class EmailComponent implements OnInit {
  // Aba ativa: 'config' (formulário) ou 'overview' (visualizador do Outlook)
  activeTab: 'config' | 'overview' = 'config';
  // Sub-aba na visão Outlook: 'accounts' (Email) ou 'datafiles' (Arquivos de Dados)
  overviewSubTab: 'accounts' | 'datafiles' = 'accounts';

  // Detecção de Perfil
  detection: OutlookProfileDetection | null = null;
  loadingDetect = false;

  // Parâmetros da Conta
  displayName = '';
  emailAddress = '';
  domain = 'empresa.com.br';
  password = '';
  hidePassword = true;
  accountType: 'Imap' | 'Pop3' = 'Pop3';
  incomingServer = 'mail.empresa.com.br';
  incomingPort = 995;
  incomingUseSSL = true;
  outgoingServer = 'mail.empresa.com.br';
  outgoingPort = 587;
  outgoingUseSSL = true;
  outgoingRequireAuth = true;

  // Gerenciamento de Arquivo de Dados (.PST)
  pstModeOption: 'new' | 'existing' = 'new';
  selectedPstPath = '';
  customPstPath = '';
  detectedPstCandidates: PstCandidate[] = [];
  matchingPstFound: PstCandidate | null = null;
  loadingPstCandidates = false;

  // Estados de Operação
  loadingConfig = false;
  lastConfigResult: OutlookConfigResult | null = null;
  deletingSlot: string | null = null;
  deletingKey: string | null = null;

  constructor(
    private emailService: EmailService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.detectarPerfil();
    this.carregarCandidatosPst();
  }

  detectarPerfil(): void {
    this.loadingDetect = true;
    this.cdr.detectChanges();

    this.emailService.detectProfile()
      .pipe(finalize(() => {
        this.loadingDetect = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.detection = res.data;
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Falha ao detectar perfil do Outlook:', err);
          this.cdr.detectChanges();
        }
      });
  }

  carregarCandidatosPst(emailToSearch: string = ''): void {
    this.loadingPstCandidates = true;
    this.cdr.detectChanges();

    this.emailService.getPstCandidates(emailToSearch)
      .pipe(finalize(() => {
        this.loadingPstCandidates = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.detectedPstCandidates = res.data || [];
          // Verifica se há candidato que coincide com o e-mail atual
          const match = this.detectedPstCandidates.find(c => c.matches_email);
          this.matchingPstFound = match || null;
          if (match && this.pstModeOption === 'existing' && !this.selectedPstPath) {
            this.selectedPstPath = match.full_path;
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.warn('Falha ao listar candidatos PST:', err);
          this.cdr.detectChanges();
        }
      });
  }

  onEmailChange(): void {
    if (!this.emailAddress) return;

    if (this.emailAddress.includes('@')) {
      const parts = this.emailAddress.split('@');
      if (parts[1]) {
        this.domain = parts[1].trim().toLowerCase();
        this.onDomainChange();
      }
    }

    // Busca candidatos PST para o novo e-mail
    this.carregarCandidatosPst(this.emailAddress);
  }

  onDomainChange(): void {
    const clean = this.domain.trim().replace(/^@/, '');
    if (this.accountType === 'Pop3') {
      this.incomingServer = `mail.${clean}`;
      this.incomingPort = 995;
    } else {
      this.incomingServer = `mail.${clean}`;
      this.incomingPort = 993;
    }
    this.outgoingServer = `mail.${clean}`;
    this.outgoingPort = 587;
    this.cdr.detectChanges();
  }

  onAccountTypeChange(): void {
    if (this.accountType === 'Pop3') {
      this.incomingPort = 995;
    } else {
      this.incomingPort = 993;
    }
    this.cdr.detectChanges();
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
    this.cdr.detectChanges();
  }

  acceptSuggestedPst(pst: PstCandidate): void {
    this.pstModeOption = 'existing';
    this.selectedPstPath = pst.full_path;
    this.matchingPstFound = null; // Dispensar banner
    this.cdr.detectChanges();
  }

  dismissSuggestedPst(): void {
    this.matchingPstFound = null;
    this.cdr.detectChanges();
  }

  configurarConta(): void {
    // Validações no Frontend
    if (!this.emailAddress || !this.emailAddress.includes('@')) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        disableClose: true,
        data: {
          title: 'Atenção: E-mail Inválido',
          message: 'Por favor, informe um endereço de e-mail corporativo válido (ex: <em>usuario@empresa.com.br</em>).',
          type: 'warning',
          hideCancel: true
        }
      });
      return;
    }

    if (!this.password || this.password.trim().length === 0) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        disableClose: true,
        data: {
          title: 'Senha Obrigatória',
          message: 'Informe a senha da conta de e-mail. Ela é fundamental para autenticação e criação automática da conta no Outlook com criptografia DPAPI.',
          type: 'warning',
          hideCancel: true
        }
      });
      return;
    }

    let finalPstPath = '';
    if (this.pstModeOption === 'existing') {
      finalPstPath = (this.selectedPstPath === 'custom' ? this.customPstPath : this.selectedPstPath).trim();
      if (!finalPstPath) {
        this.dialog.open(ConfirmDialogComponent, {
          width: '420px',
          disableClose: true,
          data: {
            title: 'Arquivo PST Não Informado',
            message: 'Você optou por sincronizar com um arquivo PST existente. Selecione um arquivo da lista ou digite o caminho completo do arquivo .pst.',
            type: 'warning',
            hideCancel: true
          }
        });
        return;
      }
    }

    const payload: OutlookConfigPayload = {
      display_name: this.displayName.trim() || this.emailAddress.split('@')[0],
      email_address: this.emailAddress.trim().toLowerCase(),
      domain: this.domain.trim().toLowerCase(),
      password: this.password,
      account_type: this.accountType,
      incoming_server: this.incomingServer.trim(),
      incoming_port: Number(this.incomingPort),
      incoming_use_ssl: this.incomingUseSSL,
      outgoing_server: this.outgoingServer.trim(),
      outgoing_port: Number(this.outgoingPort),
      outgoing_use_ssl: this.outgoingUseSSL,
      outgoing_require_auth: this.outgoingRequireAuth,
      use_existing_pst: this.pstModeOption === 'existing',
      existing_pst_path: finalPstPath
    };

    this.loadingConfig = true;
    this.cdr.detectChanges();

    this.emailService.configureEmail(payload)
      .pipe(finalize(() => {
        this.loadingConfig = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (res) => {
          this.lastConfigResult = res.data;
          const isLinked = res.data.pst_mode === 'linked_existing';
          const pstActionText = isLinked
            ? `Sincronizado e vinculado com sucesso ao arquivo PST existente:`
            : `Novo arquivo de dados (.pst) criado com sucesso em:`;

          this.dialog.open(ConfirmDialogComponent, {
            width: '460px',
            disableClose: true,
            data: {
              title: 'E-mail Configurado no Outlook',
              message: `A conta <strong>${payload.email_address}</strong> foi registrada no perfil do Microsoft Outlook com senha autenticada via DPAPI.<br><br>` +
                       `${pstActionText}<br><code style="font-size:11px; word-break:break-all; background:#f1f5f9; padding:4px 8px; border-radius:4px; display:block; margin-top:6px;">${res.data.data_store_path}</code><br>` +
                       `<small style="color:#64748b;">Slot da Conta: ${res.data.account_index_hex} | Slot do Store: ${res.data.store_index_hex}</small>`,
              type: 'success',
              hideCancel: true
            }
          });

          // Atualiza detecção e lista de PSTs
          this.detectarPerfil();
          this.carregarCandidatosPst();
          this.cdr.detectChanges();
        },
        error: (err) => {
          const msg = err.error?.error?.message || err.error?.message || err.message;
          this.dialog.open(ConfirmDialogComponent, {
            width: '440px',
            disableClose: true,
            data: {
              title: 'Erro na Configuração',
              message: `Falha ao gravar configurações no perfil do Outlook:<br><br><code>${msg}</code>`,
              type: 'danger',
              hideCancel: true
            }
          });
          this.cdr.detectChanges();
        }
      });
  }

  removerConta(acct: any): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: 'Remover Conta de E-mail',
        subtitle: `Confirmação de exclusão do Microsoft Outlook`,
        message: `Tem certeza de que deseja remover a conta <strong>${acct.email}</strong> (Slot ${acct.slot}) do Microsoft Outlook?<br><br>` +
                 `Esta ação removerá as credenciais e desconectará os servidores de correio do perfil ativo.`,
        confirmText: 'Continuar Remoção',
        cancelText: 'Cancelar',
        isDestructive: true,
        type: 'danger',
        icon: 'delete'
      }
    });

    dialogRef.afterClosed().subscribe((proceed) => {
      if (!proceed) return;

      // Pergunta 2: Excluir também o arquivo de dados (.pst) físico?
      const pstDialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '480px',
        disableClose: true,
        data: {
          title: 'Excluir Arquivo de Dados (.PST)?',
          subtitle: 'Atenção aos dados locais armazenados',
          message: `Deseja também <strong>excluir permanentemente o arquivo de dados (.pst)</strong> do computador?<br><br>` +
                   `<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px; font-size:12px; color:#991b1b; margin-bottom:10px;">` +
                   `<strong>Atenção:</strong> Se optar por excluir o arquivo .pst, todas as mensagens, pastas e históricos salvos localmente serão perdidos.</div>` +
                   `• <strong>Sim, Excluir Arquivo PST:</strong> Remove a conta e apaga o arquivo físico do disco.<br>` +
                   `• <strong>Não, Manter Arquivo Salvo:</strong> Remove a conta do Outlook mas preserva o arquivo .pst seguro no computador.`,
          confirmText: 'Sim, Excluir Arquivo PST',
          cancelText: 'Não, Manter Arquivo Salvo',
          isDestructive: true,
          type: 'warning',
          icon: 'delete_forever'
        }
      });

      pstDialogRef.afterClosed().subscribe((deletePstChoice) => {
        const deletePst = Boolean(deletePstChoice);
        this.deletingSlot = acct.slot;
        this.cdr.detectChanges();

        this.emailService.deleteAccount(acct.slot, deletePst)
          .pipe(finalize(() => {
            this.deletingSlot = null;
            this.cdr.detectChanges();
          }))
          .subscribe({
            next: (res) => {
              const pstStatus = deletePst
                ? (res.data?.pst_file_deleted
                    ? '<br><br><span style="color:#dc2626;">O arquivo .pst físico também foi excluído do computador com sucesso.</span>'
                    : '<br><br><span style="color:#d97706;">A conta foi removida, mas o arquivo .pst não pôde ser apagado (pode estar em uso pelo Outlook).</span>')
                : '<br><br><span style="color:#16a34a;">O arquivo .pst foi preservado intacto no seu computador.</span>';

              this.dialog.open(ConfirmDialogComponent, {
                width: '450px',
                disableClose: true,
                data: {
                  title: 'Conta Removida com Sucesso',
                  message: `A conta <strong>${acct.email}</strong> foi removida do perfil do Outlook.${pstStatus}`,
                  type: 'success',
                  hideCancel: true
                }
              });

              this.detectarPerfil();
              this.carregarCandidatosPst();
              this.cdr.detectChanges();
            },
            error: (err) => {
              const msg = err.error?.error?.message || err.error?.message || err.message;
              this.dialog.open(ConfirmDialogComponent, {
                width: '440px',
                disableClose: true,
                data: {
                  title: 'Falha na Remoção',
                  message: `Não foi possível remover a conta:<br><br><code>${msg}</code>`,
                  type: 'danger',
                  hideCancel: true
                }
              });
              this.cdr.detectChanges();
            }
          });
      });
    });
  }

  removerArquivoDados(df: any): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        title: 'Remover Arquivo de Dados (.PST)',
        subtitle: 'Desvinculação do perfil do Microsoft Outlook',
        message: `Tem certeza de que deseja remover o arquivo de dados <strong>${df.name}</strong> do perfil do Outlook?<br><br>` +
                 `<code style="font-size:12px; word-break:break-all; background:#f1f5f9; padding:4px 8px; border-radius:4px; display:block;">${df.file_path}</code>`,
        confirmText: 'Continuar',
        cancelText: 'Cancelar',
        isDestructive: true,
        type: 'warning',
        icon: 'folder_off'
      }
    });

    dialogRef.afterClosed().subscribe((proceed) => {
      if (!proceed) return;

      const pstDialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '480px',
        disableClose: true,
        data: {
          title: 'Excluir Arquivo Físico do Disco?',
          subtitle: 'Atenção aos dados locais armazenados',
          message: `Deseja também <strong>apagar fisicamente o arquivo .pst do disco rígido</strong>?<br><br>` +
                   `<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px; font-size:12px; color:#991b1b; margin-bottom:10px;">` +
                   `<strong>Atenção:</strong> A exclusão física apagará permanentemente o arquivo <code>${df.file_path}</code>.</div>` +
                   `• <strong>Sim, Apagar do Disco:</strong> Desvincula e apaga o arquivo do computador.<br>` +
                   `• <strong>Não, Apenas Desvincular:</strong> Remove do Outlook, mantendo o arquivo seguro no disco.`,
          confirmText: 'Sim, Apagar do Disco',
          cancelText: 'Não, Apenas Desvincular',
          isDestructive: true,
          type: 'danger',
          icon: 'delete_forever'
        }
      });

      pstDialogRef.afterClosed().subscribe((deletePstChoice) => {
        const deletePst = Boolean(deletePstChoice);
        this.deletingKey = df.key;
        this.cdr.detectChanges();

        this.emailService.deleteDataFile(df.key, deletePst)
          .pipe(finalize(() => {
            this.deletingKey = null;
            this.cdr.detectChanges();
          }))
          .subscribe({
            next: (res) => {
              const fileMsg = deletePst
                ? (res.data?.pst_file_deleted
                    ? '<br><br><span style="color:#dc2626;">Arquivo .pst excluído do disco com sucesso.</span>'
                    : '<br><br><span style="color:#d97706;">Desvinculado do Outlook, mas o arquivo físico não pôde ser apagado.</span>')
                : '<br><br><span style="color:#16a34a;">Arquivo mantido intacto no computador.</span>';

              this.dialog.open(ConfirmDialogComponent, {
                width: '450px',
                disableClose: true,
                data: {
                  title: 'Arquivo de Dados Removido',
                  message: `O arquivo de dados foi desvinculado com sucesso do perfil do Outlook.${fileMsg}`,
                  type: 'success',
                  hideCancel: true
                }
              });

              this.detectarPerfil();
              this.carregarCandidatosPst();
              this.cdr.detectChanges();
            },
            error: (err) => {
              const msg = err.error?.error?.message || err.error?.message || err.message;
              this.dialog.open(ConfirmDialogComponent, {
                width: '440px',
                disableClose: true,
                data: {
                  title: 'Falha na Remoção',
                  message: `Não foi possível remover o arquivo de dados:<br><br><code>${msg}</code>`,
                  type: 'danger',
                  hideCancel: true
                }
              });
              this.cdr.detectChanges();
            }
          });
      });
    });
  }
}
