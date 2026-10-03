/**
 * Brána: svc-model na CPU — build s výslovnou sadou instrukcí, vlákna odvozená z kvóty.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (čtením repa, kontejner tu spustit nejde):
 *   · Dockerfile.svc-model: `CMAKE_ARGS="-DGGML_NATIVE=OFF"` + `llama-cpp-python[server]>=0.3`.
 *     Sada SIMD instrukcí tak byla IMPLICITNÍ (výchozí hodnoty CMake nepřipnuté verze
 *     llama.cpp + prostředí buildu) — z repa nešlo říct, jestli image AVX2/FMA vůbec má.
 *     Cílový hardware (AMD EPYC 7302P, jen CPU) přitom x86-64-v3 umí.
 *   · compose `MODEL_N_THREADS=${MODEL_N_THREADS:-2}` + entrypoint `get("MODEL_N_THREADS", "2")`:
 *     literál bez vztahu ke kvótě kontejneru, a `n_threads_batch` NENASTAVENÉ — llama_cpp.server
 *     ho bere z `multiprocessing.cpu_count()` = CPU hostitele (8), ne z `cpus: 2.0`.
 *
 * Co brána drží:
 *   1. přesný pin llama-cpp-python (`==`), GGML_NATIVE=OFF a VÝSLOVNĚ AVX/AVX2/FMA/F16C=ON,
 *      AVX512=OFF (přenositelné na každý AVX2 hostitel), build sám ověří AVX2 v knihovně,
 *   2. entrypoint nastavuje n_threads I n_threads_batch z odvozené hodnoty, bez literálu,
 *   3. odvození vláken se chová podle kvóty (cgroup v2 i v1), bez limitu podle nproc,
 *      a výslovná deklarace musí být kladné celé číslo — překlep je chyba, ne „odvoď si".
 */
import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCKERFILE = readFileSync(join(ROOT, "Dockerfile.svc-model"), "utf-8");
const ENTRYPOINT = readFileSync(join(ROOT, "scripts/deploy/svc-model-entrypoint.sh"), "utf-8");
const COMPOSE = readFileSync(join(ROOT, "docker-compose.coolify-model.yml"), "utf-8");
const THREADS_LIB = join(ROOT, "scripts/deploy/svc-model-threads.sh");

/** Aktivní (nezakomentované) řádky Dockerfile — komentář nesmí bránu splnit. */
const dockerfileCode = DOCKERFILE.split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

function vlakna(env: Record<string, string>, cgroup: Record<string, string> | null): { code: number; out: string; err: string } {
  const root = mkdtempSync(join(tmpdir(), "svc-model-cgroup-"));
  try {
    for (const [rel, obsah] of Object.entries(cgroup ?? {})) {
      const cesta = join(root, rel);
      mkdirSync(join(cesta, ".."), { recursive: true });
      writeFileSync(cesta, obsah);
    }
    const r = spawnSync("sh", ["-c", `. "${THREADS_LIB}"; model_threads "$CGROUP_ROOT"`], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", CGROUP_ROOT: root, ...env },
    });
    return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("svc-model: build s výslovnou sadou instrukcí", () => {
  test("llama-cpp-python je připnutý na PŘESNOU verzi", () => {
    expect(dockerfileCode).toMatch(/llama-cpp-python\[server\]==\d+\.\d+\.\d+/);
    expect(dockerfileCode, "rozsah verzí = každý rebuild jiný llama.cpp").not.toMatch(/llama-cpp-python[^\n"]*>=/);
  });

  test("GGML_NATIVE=OFF a x86-64-v3 instrukce výslovně ON, AVX512 výslovně OFF", () => {
    const m = /CMAKE_ARGS="([^"]+)"/.exec(dockerfileCode);
    expect(m, "CMAKE_ARGS chybí").not.toBeNull();
    const args = m![1];
    expect(args).toContain("-DGGML_NATIVE=OFF");
    for (const f of ["AVX", "AVX2", "FMA", "F16C"]) {
      expect(args, `GGML_${f} musí být výslovně ON`).toMatch(new RegExp(`-DGGML_${f}=ON\\b`));
    }
    expect(args, "AVX512 by image zavřel před AVX2 hostiteli").toMatch(/-DGGML_AVX512=OFF\b/);
  });

  test("build sám změří, že knihovna AVX2 i FMA opravdu má", () => {
    expect(dockerfileCode).toMatch(/llama_print_system_info\(\)/);
    expect(dockerfileCode).toContain("AVX2 = 1");
    expect(dockerfileCode).toContain("FMA = 1");
  });

  test("image nese knihovnu odvození vláken", () => {
    expect(dockerfileCode).toMatch(/COPY scripts\/deploy\/svc-model-threads\.sh /);
  });
});

describe("svc-model: vlákna odvozená, ne literál", () => {
  test("⛔ entrypoint nastavuje n_threads I n_threads_batch z odvozené hodnoty", () => {
    expect(ENTRYPOINT, "entrypoint předává kořen cgroup výslovně").toMatch(/model_threads \/sys\/fs\/cgroup\b/);
    const n = (ENTRYPOINT.match(/"n_threads": int\(os\.environ\["MODEL_THREADS"\]\)/g) ?? []).length;
    const nb = (ENTRYPOINT.match(/"n_threads_batch": int\(os\.environ\["MODEL_THREADS"\]\)/g) ?? []).length;
    expect(n, "každá lane (chat, embed, embed2) má n_threads").toBe(3);
    expect(nb, "bez n_threads_batch bere server CPU hostitele").toBe(3);
    expect(ENTRYPOINT, "literál vláken").not.toMatch(/MODEL_N_THREADS",\s*"\d+"/);
  });

  test("compose vlákna nedosazuje", () => {
    expect(COMPOSE).toMatch(/MODEL_N_THREADS=\$\{MODEL_N_THREADS:-\}/);
    expect(COMPOSE).not.toMatch(/MODEL_N_THREADS:-\d/);
  });

  test("cgroup v2: kvóta 2,0 CPU → 2; 2,5 → 2 (dolů); 0,5 → 1 (nejméně jedno)", () => {
    expect(vlakna({}, { "cpu.max": "200000 100000\n" }).out).toBe("2");
    expect(vlakna({}, { "cpu.max": "250000 100000\n" }).out).toBe("2");
    expect(vlakna({}, { "cpu.max": "50000 100000\n" }).out).toBe("1");
  });

  test("cgroup v1: cfs kvóta 3 CPU → 3", () => {
    expect(vlakna({}, { "cpu/cpu.cfs_quota_us": "300000\n", "cpu/cpu.cfs_period_us": "100000\n" }).out).toBe("3");
  });

  test("bez limitu (v2 'max', v1 -1, žádná cgroup) → počet CPU procesu (nproc)", () => {
    const nproc = execFileSync("sh", ["-c", "nproc 2>/dev/null || getconf _NPROCESSORS_ONLN"], { encoding: "utf-8" }).trim();
    expect(vlakna({}, { "cpu.max": "max 100000\n" }).out).toBe(nproc);
    expect(vlakna({}, { "cpu/cpu.cfs_quota_us": "-1\n", "cpu/cpu.cfs_period_us": "100000\n" }).out).toBe(nproc);
    expect(vlakna({}, null).out).toBe(nproc);
  });

  test("⛔ bez kořene cgroup je to CHYBA — knihovna si cestu nedosazuje", () => {
    const r = spawnSync("sh", ["-c", `. "${THREADS_LIB}"; model_threads`], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(r.status, "model_threads bez argumentu prošlo").not.toBe(0);
    expect((r.stdout ?? "").trim()).toBe("");
  });

  test("výslovná deklarace MODEL_N_THREADS vyhrává nad kvótou", () => {
    expect(vlakna({ MODEL_N_THREADS: "6" }, { "cpu.max": "200000 100000\n" }).out).toBe("6");
  });

  test("⛔ nečíselná / nulová deklarace je CHYBA, ne tichý přechod na odvození", () => {
    for (const spatne of ["dva", "0", "-2", "2.5"]) {
      const r = vlakna({ MODEL_N_THREADS: spatne }, { "cpu.max": "200000 100000\n" });
      expect(r.code, `MODEL_N_THREADS=${spatne} prošlo`).not.toBe(0);
      expect(r.out).toBe("");
    }
  });
});
