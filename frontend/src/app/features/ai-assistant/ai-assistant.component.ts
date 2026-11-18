import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { finalize } from 'rxjs';
import { AiService, AiConfig, ChatMessage } from './ai.service';

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule],
  templateUrl: './ai-assistant.component.html',
  styleUrls: ['./ai-assistant.component.css']
})
export class AiAssistantComponent implements OnInit {
  config: AiConfig = {
    gatewayUrl: 'http://localhost:3000',
    apiKey: '',
    provider: 'GEMINI',
    model: 'gemini-2.5-flash',
    temperature: 0.2
  };

  showSettings = false;
  userInput = '';
  loading = false;
  loadingConfig = false;
  adminElevated = false;
  loadingAdmin = false;

  messages: ChatMessage[] = [
    {
      role: 'assistant',
      content: 'Olá! Sou o Assistente Autônomo de TI do DC-TI. Possuo acesso direto ao sistema para executar diagnósticos, limpezas, reparos e comandos no Windows conforme suas instruções.\n\nComo posso ajudar você na manutenção deste computador hoje?'
    }
  ];

  quickActions = [
    'Verifique o estado geral da máquina e saúde dos discos.',
    'Execute uma limpeza de arquivos temporários e esvazie o cache DNS.',
    'Verifique se há arquivos corrompidos no sistema operacional (SFC).',
    'O spooler de impressão está travado, pode reiniciar e corrigir?'
  ];

  constructor(
    private aiService: AiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.carregarConfig();
    this.verificarAdmin();
  }

  verificarAdmin(): void {
    this.aiService.getAdminStatus().subscribe({
      next: (res) => {
        this.adminElevated = Boolean(res.data?.elevated);
        this.cdr.detectChanges();
      }
    });
  }

  alternarAdmin(): void {
    if (this.loadingAdmin) return;
    this.loadingAdmin = true;
    this.cdr.detectChanges();

    this.aiService.toggleAdmin()
      .pipe(finalize(() => { this.loadingAdmin = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.adminElevated = Boolean(res.data?.elevated);
          this.messages.push({
            role: 'assistant',
            content: this.adminElevated
              ? '🛡️ **Privilégios de Administrador ativados com sucesso!** (`admin_elevated: true`)\n\nO sistema e as ferramentas de reparo do MCP agora operam com controle administrativo confirmado.'
              : 'ℹ️ **Privilégios de Administrador desativados.** (`admin_elevated: false`)\n\nO sistema agora está no modo de usuário padrão.'
          });
          this.cdr.detectChanges();
        }
      });
  }

  confirmarPrivilegiosAdmin(): void {
    this.alternarAdmin();
  }

  carregarConfig(): void {
    this.aiService.getConfig().subscribe({
      next: (res) => {
        this.config = res.data;
        if (!this.config.apiKey) {
          this.showSettings = true;
        }
        this.cdr.detectChanges();
      }
    });
  }

  salvarConfig(): void {
    this.loadingConfig = true;
    this.cdr.detectChanges();
    this.aiService.saveConfig(this.config)
      .pipe(finalize(() => { this.loadingConfig = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.config = res.data;
          this.showSettings = false;
          this.cdr.detectChanges();
        }
      });
  }

  enviarMensagem(texto?: string): void {
    const prompt = (texto || this.userInput).trim();
    if (!prompt || this.loading) return;

    this.messages.push({ role: 'user', content: prompt });
    this.userInput = '';
    this.loading = true;
    this.cdr.detectChanges();

    this.aiService.sendMessage(this.messages)
      .pipe(finalize(() => { this.loading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          this.messages.push({ role: 'assistant', content: res.data.reply });
          this.cdr.detectChanges();
        },
        error: (err) => {
          const errMsg = err.error?.error?.message || err.message || 'Falha ao processar solicitação com o Gateway de IA.';
          this.messages.push({
            role: 'assistant',
            content: `⚠️ **Erro na Execução da IA:** ${errMsg}\n\nVerifique se o Doce LLM Gateway está em execução e se o seu Bearer Token está configurado no ícone de engrenagem acima.`
          });
          this.cdr.detectChanges();
        }
      });
  }

  formatContent(content: string): string {
    return content
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  }
}

