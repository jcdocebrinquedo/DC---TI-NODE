'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { formatLocalDateTime } = require('../utils/local-date');
const { AppError } = require('../utils/app-error');
const mailAuthTester = require('./mail-auth-tester.service');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(__dirname, '../scripts/outlook-tools.ps1');

class OutlookConfigService {
  /**
   * Executa o script PowerShell de automação do Outlook.
   * @param {string[]} args
   * @returns {Promise<any>}
   */
  async #execScript(args) {
    try {
      const psArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        ...args
      ];
      const { stdout, stderr } = await execFileAsync('powershell.exe', psArgs, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });

      if (stderr && stderr.trim().length > 0) {
        console.warn('[OutlookConfigService] PowerShell stderr:', stderr);
      }

      const raw = stdout.trim();
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      if (err.stdout) {
        try {
          const parsed = JSON.parse(err.stdout.trim());
          if (parsed && parsed.error) {
            throw new AppError('E_OUTLOOK_CONFIG', parsed.error);
          }
        } catch (_) {}
      }
      throw new AppError('E_OUTLOOK_EXEC', `Falha na automação do Outlook: ${err.message}`);
    }
  }

  /**
   * Detecta o perfil padrão do Outlook, contas já configuradas e arquivos de dados (.pst/.ost).
   */
  async detectProfile() {
    return await this.#execScript(['-Action', 'DetectProfile']);
  }

  /**
   * Busca arquivos .PST no computador e indica se coincidem com o e-mail informado.
   * @param {string} email
   */
  async findPstCandidates(email = '') {
    const res = await this.#execScript(['-Action', 'FindPstCandidates', '-Email', email || '']);
    return Array.isArray(res) ? res : (res ? [res] : []);
  }

  /**
   * Realiza teste prévio de autenticação real (logon POP3/IMAP e SMTP).
   * @param {object} config
   */
  async testAuthentication(config) {
    const {
      email_address = '',
      password = '',
      incoming_server = '',
      outgoing_server = ''
    } = config;

    if (!email_address || !email_address.includes('@')) {
      throw new AppError('E_VALIDATION', 'Endereço de e-mail corporativo inválido.');
    }
    if (!password || password.trim().length === 0) {
      throw new AppError('E_VALIDATION', 'A senha do e-mail é obrigatória para testar a autenticação.');
    }
    if (!incoming_server || !outgoing_server) {
      throw new AppError('E_VALIDATION', 'Os servidores de entrada e saída são obrigatórios.');
    }

    return await mailAuthTester.testAll(config);
  }

  /**
   * Configura a conta corporativa de e-mail e seu Arquivo de Dados (.pst) no Microsoft Outlook.
   * @param {object} config
   */
  async configureEmail(config) {
    const {
      display_name = '',
      email_address = '',
      domain = '',
      password = '',
      account_type = 'Imap',
      incoming_server = '',
      incoming_port = 993,
      incoming_use_ssl = true,
      outgoing_server = '',
      outgoing_port = 587,
      outgoing_use_ssl = true,
      outgoing_require_auth = true,
      use_existing_pst = false,
      existing_pst_path = '',
      skip_auth_test = false
    } = config;

    if (!email_address || !email_address.includes('@')) {
      throw new AppError('E_VALIDATION', 'Endereço de e-mail corporativo inválido.');
    }
    if (!password || password.trim().length === 0) {
      throw new AppError('E_VALIDATION', 'A senha do e-mail é obrigatória para a configuração no Outlook.');
    }
    if (!incoming_server || !outgoing_server) {
      throw new AppError('E_VALIDATION', 'Os servidores de entrada e saída são obrigatórios.');
    }

    // Validação de autenticação prévia idêntica ao Microsoft Outlook
    if (!skip_auth_test) {
      const authTest = await mailAuthTester.testAll(config);
      if (!authTest.ok) {
        throw new AppError(
          'E_AUTH_FAILED',
          `Falha no teste de autenticação da conta: ${authTest.error_message}. Verifique a senha ou os servidores e tente novamente.`,
          authTest
        );
      }
    }

    const cleanDomain = domain
      ? domain.trim().replace(/^@/, '').toLowerCase()
      : email_address.split('@')[1].toLowerCase();

    const inputData = {
      displayName: display_name.trim() || email_address.split('@')[0],
      emailAddress: email_address.trim().toLowerCase(),
      domain: cleanDomain,
      password: password,
      accountType: account_type === 'Pop3' ? 'Pop3' : 'Imap',
      incomingServer: incoming_server.trim(),
      incomingPort: Number(incoming_port) || (account_type === 'Pop3' ? 995 : 993),
      incomingUseSSL: Boolean(incoming_use_ssl),
      outgoingServer: outgoing_server.trim(),
      outgoingPort: Number(outgoing_port) || 587,
      outgoingUseSSL: Boolean(outgoing_use_ssl),
      outgoingRequireAuth: Boolean(outgoing_require_auth),
      useExistingPst: Boolean(use_existing_pst),
      existingPstPath: (existing_pst_path || '').trim()
    };

    // Grava temporariamente arquivo de configuração para evitar limites de linha de comando
    const tempFile = path.join(os.tmpdir(), `dc_outlook_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
    try {
      await fs.promises.writeFile(tempFile, JSON.stringify(inputData), 'utf8');
      const res = await this.#execScript(['-Action', 'ConfigureEmail', '-ConfigFile', tempFile]);
      res.configured_at_local = formatLocalDateTime();
      return res;
    } finally {
      fs.promises.unlink(tempFile).catch(() => {});
    }
  }

  /**
   * Remove uma conta de e-mail do perfil do Outlook e, opcionalmente, seu arquivo de dados (.pst) físico.
   * @param {string} slot
   * @param {boolean} deletePstFile
   */
  async removeAccount(slot, deletePstFile = false) {
    if (!slot || !/^[0-9a-fA-F]{8}$/.test(slot.trim())) {
      throw new AppError('E_VALIDATION', 'Identificador de slot de conta inválido.');
    }

    const res = await this.#execScript([
      '-Action', 'RemoveAccount',
      '-Slot', slot.trim(),
      '-DeletePstFile', deletePstFile ? '1' : '0'
    ]);
    res.removed_at_local = formatLocalDateTime();
    return res;
  }

  /**
   * Remove um arquivo de dados (.pst) do perfil do Outlook e, opcionalmente, o arquivo físico do disco.
   * @param {string} key
   * @param {boolean} deletePstFile
   */
  async removeDataFile(key, deletePstFile = false) {
    if (!key || key.trim().length === 0) {
      throw new AppError('E_VALIDATION', 'Identificador de arquivo de dados inválido.');
    }

    const res = await this.#execScript([
      '-Action', 'RemoveDataFile',
      '-Key', key.trim(),
      '-DeletePstFile', deletePstFile ? '1' : '0'
    ]);
    res.removed_at_local = formatLocalDateTime();
    return res;
  }
}

module.exports = new OutlookConfigService();
