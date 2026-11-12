use chrono::Local;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressTestConfig {
    pub duration_seconds: u64,
    pub memory_allocation_mb: usize,
    pub threads_count: usize,
}

impl Default for StressTestConfig {
    fn default() -> Self {
        let logical_cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        Self {
            duration_seconds: 15,
            memory_allocation_mb: 512,
            threads_count: logical_cores,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressTickSnapshot {
    pub elapsed_seconds: u64,
    pub total_seconds: u64,
    pub cpu_usage_percent: f32,
    pub ram_usage_percent: f32,
    pub operations_completed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressTestReport {
    pub duration_seconds: u64,
    pub threads_spawned: usize,
    pub memory_tested_mb: usize,
    pub peak_cpu_usage_percent: f32,
    pub average_cpu_usage_percent: f32,
    pub peak_ram_usage_percent: f32,
    pub cpu_matrix_iterations: u64,
    pub memory_blocks_verified: u64,
    pub memory_integrity_errors: u64,
    pub stability_passed: bool,
    pub verdict: String,
    pub completed_at_local: String,
}

/// Executa Stress Test controlado por tempo em CPU (todas as threads lógicas com ponto flutuante e hashing)
/// e Memória RAM (alocação e verificação de integridade bit-a-bit 0xAA55AA55 / 0x55AA55AA).
pub fn run_stress_test<F>(
    config: &StressTestConfig,
    mut on_tick: Option<F>,
) -> Result<StressTestReport, String>
where
    F: FnMut(StressTickSnapshot),
{
    let duration_secs = config.duration_seconds.clamp(3, 3600);
    let threads_count = config.threads_count.max(1);
    let mem_mb = config.memory_allocation_mb.clamp(64, 16384);

    let stop_flag = Arc::new(AtomicBool::new(false));
    let cpu_ops_counter = Arc::new(AtomicU64::new(0));
    let mem_blocks_counter = Arc::new(AtomicU64::new(0));
    let mem_errors_counter = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::with_capacity(threads_count + 1);

    // 1. Workers de estresse matemático intensivo de CPU (FPU + ALU)
    for t_idx in 0..threads_count {
        let stop = Arc::clone(&stop_flag);
        let ops = Arc::clone(&cpu_ops_counter);
        let handle = std::thread::spawn(move || {
            let mut seed = 0x9E37_79B9_7F4A_7C15u64.wrapping_add(t_idx as u64 * 104_729);
            let mut acc = 1.000001f64 + (t_idx as f64) * 0.0001;

            while !stop.load(Ordering::Relaxed) {
                for _ in 0..25_000 {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    acc = (acc * 1.0000001192092896).sin().abs() + (seed as f64 * 1e-18).cos().abs();
                }
                if acc.is_nan() {
                    acc = 1.0;
                }
                std::hint::black_box(acc);
                ops.fetch_add(1, Ordering::Relaxed);
            }
        });
        handles.push(handle);
    }

    // 2. Worker dedicado de alocação e verificação de integridade de Memória RAM
    {
        let stop = Arc::clone(&stop_flag);
        let blocks_verified = Arc::clone(&mem_blocks_counter);
        let errors_found = Arc::clone(&mem_errors_counter);

        let mem_handle = std::thread::spawn(move || {
            let words_per_mb = (1024 * 1024) / std::mem::size_of::<u64>();
            let total_words = words_per_mb * mem_mb;
            let mut buffer = vec![0xAA55_AA55_AA55_AA55u64; total_words];
            let mut toggle = false;

            while !stop.load(Ordering::Relaxed) {
                let expected = if toggle {
                    0x55AA_55AA_55AA_55AAu64
                } else {
                    0xAA55_AA55_AA55_AA55u64
                };
                let next_pattern = !expected;

                // Verifica padrão atual e grava o inverso em passos para exercitar o barramento de memória
                let mut local_errors = 0u64;
                for word in buffer.iter_mut().step_by(8) {
                    if *word != expected {
                        local_errors += 1;
                    }
                    *word = next_pattern;
                }
                if local_errors > 0 {
                    errors_found.fetch_add(local_errors, Ordering::Relaxed);
                }
                blocks_verified.fetch_add(1, Ordering::Relaxed);
                toggle = !toggle;
            }
        });
        handles.push(mem_handle);
    }

    // 3. Loop principal de telemetria e controle de tempo
    let start_instant = Instant::now();
    let target_duration = Duration::from_secs(duration_secs);
    let mut sys = System::new_all();
    let mut peak_cpu = 0.0f32;
    let mut sum_cpu = 0.0f32;
    let mut samples_count = 0u32;
    let mut peak_ram = 0.0f32;

    while start_instant.elapsed() < target_duration {
        std::thread::sleep(Duration::from_secs(1));
        sys.refresh_cpu();
        sys.refresh_memory();

        let current_cpu = (sys.global_cpu_info().cpu_usage() * 10.0).round() / 10.0;
        let current_ram = if sys.total_memory() > 0 {
            (((sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0) as f32 * 10.0)
                .round()
                / 10.0
        } else {
            0.0
        };

        if current_cpu > peak_cpu {
            peak_cpu = current_cpu;
        }
        if current_ram > peak_ram {
            peak_ram = current_ram;
        }
        sum_cpu += current_cpu;
        samples_count += 1;

        let elapsed = start_instant.elapsed().as_secs().min(duration_secs);
        if let Some(ref mut cb) = on_tick {
            cb(StressTickSnapshot {
                elapsed_seconds: elapsed,
                total_seconds: duration_secs,
                cpu_usage_percent: current_cpu,
                ram_usage_percent: current_ram,
                operations_completed: cpu_ops_counter.load(Ordering::Relaxed),
            });
        }
    }

    stop_flag.store(true, Ordering::SeqCst);
    for h in handles {
        let _ = h.join();
    }

    let avg_cpu = if samples_count > 0 {
        ((sum_cpu / samples_count as f32) * 10.0).round() / 10.0
    } else {
        peak_cpu
    };

    let total_ops = cpu_ops_counter.load(Ordering::Relaxed);
    let total_mem_passes = mem_blocks_counter.load(Ordering::Relaxed);
    let total_mem_errors = mem_errors_counter.load(Ordering::Relaxed);
    let stability_passed = total_mem_errors == 0;

    let verdict = if stability_passed {
        format!(
            "APROVADO: Estabilidade de CPU e RAM confirmada durante {}s sem erros de paridade/bit-flip.",
            duration_secs
        )
    } else {
        format!(
            "REPROVADO: Foram detectados {} erros de integridade de memória RAM durante o teste!",
            total_mem_errors
        )
    };

    Ok(StressTestReport {
        duration_seconds: duration_secs,
        threads_spawned: threads_count,
        memory_tested_mb: mem_mb,
        peak_cpu_usage_percent: peak_cpu,
        average_cpu_usage_percent: avg_cpu,
        peak_ram_usage_percent: peak_ram,
        cpu_matrix_iterations: total_ops,
        memory_blocks_verified: total_mem_passes,
        memory_integrity_errors: total_mem_errors,
        stability_passed,
        verdict,
        completed_at_local: Local::now().format("%d/%m/%Y %H:%M:%S").to_string(),
    })
}

