'use strict';

const crypto = require('node:crypto');
const { formatLocalDateTime } = require('../utils/local-date');

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.ceil(seconds);
  if (s < 60) return `~${s}s restantes`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `~${m}m ${rem}s restantes`;
}

class JobManagerService {
  constructor() {
    this.jobs = new Map();
  }

  createJob(title) {
    const id = crypto.randomUUID();
    const job = {
      id,
      title,
      status: 'running', // 'running' | 'completed' | 'failed'
      progress: 0,
      message: 'Iniciando operação...',
      eta_text: 'Calculando tempo...',
      result: null,
      error: null,
      started_ms: Date.now(),
      started_at: formatLocalDateTime(),
      finished_at: null
    };
    this.jobs.set(id, job);

    if (this.jobs.size > 100) {
      const oldestKey = this.jobs.keys().next().value;
      if (oldestKey) this.jobs.delete(oldestKey);
    }

    return job;
  }

  updateJob(id, { progress, message, eta_text }) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (typeof progress === 'number') {
      job.progress = Math.max(0, Math.min(100, Math.round(progress)));
    }
    if (typeof message === 'string' && message.trim()) {
      job.message = message.trim();
    }
    if (typeof eta_text === 'string') {
      job.eta_text = eta_text;
    } else if (job.progress >= 3 && job.progress < 100) {
      const elapsedSec = (Date.now() - job.started_ms) / 1000;
      if (elapsedSec >= 2) {
        const estRemaining = (elapsedSec * (100 - job.progress)) / job.progress;
        job.eta_text = formatEta(estRemaining);
      }
    }
    return job;
  }

  completeJob(id, result, message = 'Concluído com sucesso.') {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = 'completed';
    job.progress = 100;
    job.eta_text = '';
    job.message = message;
    job.result = result;
    job.finished_at = formatLocalDateTime();
    return job;
  }

  failJob(id, errorMessage) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = 'failed';
    job.eta_text = '';
    job.message = errorMessage || 'Falha na execução.';
    job.error = errorMessage || 'Falha na execução.';
    job.finished_at = formatLocalDateTime();
    return job;
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }
}

const jobManagerService = new JobManagerService();

module.exports = { JobManagerService, jobManagerService };
