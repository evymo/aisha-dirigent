#!/bin/sh
# svc-model-threads.sh — kolik vláken smí llama.cpp v kontejneru použít. ODVOZENO.
#
# Použití (POSIX sh, source):   . /usr/local/lib/svc-model-threads.sh
#                               THREADS="$(model_threads /sys/fs/cgroup)" || exit 1
#
# ⛔ PROČ TO NENÍ LITERÁL. Do 2026-09-13 stálo v compose `MODEL_N_THREADS=${MODEL_N_THREADS:-2}`
# a v entrypointu `n_threads: int(os.environ.get("MODEL_N_THREADS", "2"))` — číslo, které
# nevědělo nic o rozpočtu kontejneru (`cpus: ${MODEL_CPUS}`). Horší je, co NEBYLO nastavené:
# `n_threads_batch`. llama_cpp.server ho bere z `multiprocessing.cpu_count()`, a to v Pythonu
# vrací počet CPU HOSTITELE, ne cgroup kvótu. Na 8 vCPU stroji s `cpus: 2.0` tak zpracování
# promptu (a KAŽDÝ embedding — to je čistě „batch") běželo v 8 vláknech na 2 CPU kvóty:
# CFS throttling + OpenMP spin-wait. NEMĚŘENO v kontejneru (tady ho spustit nejde) — je to
# nejpravděpodobnější příčina „> 80 s na jeden embedding" z komentáře v entrypointu a musí se
# ověřit na cílovém stroji (viz docs/compose-notes/docker-compose.coolify-model.yml.md).
#
# Pořadí zdrojů (první, který ODPOVÍ, rozhoduje):
#   1) MODEL_N_THREADS — výslovná deklarace instance; musí být kladné celé číslo, jinak chyba
#      (překlep se nesmí tiše změnit v „odvoď si to").
#   2) cgroup v2  <root>/cpu.max          „<kvóta> <perioda>" | „max <perioda>"
#   3) cgroup v1  <root>/cpu/cpu.cfs_quota_us + cpu.cfs_period_us   (kvóta -1 = bez limitu)
#   4) bez limitu → počet CPU, na kterých proces smí běžet (nproc = affinity/cpuset).
# Kvóta se zaokrouhluje DOLŮ (2,5 CPU → 2 vlákna): vlákno navíc nad kvótu je throttling, ne výkon.
# Nejméně 1.
#
# Kořen cgroup je POVINNÝ argument. Kontejner předá svůj mount point, brána
# lokalni-model-cpu-build-a-vlakna podvržený strom. Stávala tu proměnná prostředí
# s dosazeným `/sys/fs/cgroup`, tedy fallback nad env jen kvůli testu (brána
# zadny-fallback-nad-identitou) — výchozí hodnota patří volajícímu, ne knihovně.

model_threads() {
    _root="${1:-}"
    if [ -z "$_root" ]; then
        echo "CHYBA: model_threads <kořen cgroup> — kořen se předává výslovně" >&2
        return 1
    fi

    if [ -n "${MODEL_N_THREADS:-}" ]; then
        case "$MODEL_N_THREADS" in
            ''|*[!0-9]*|0)
                echo "CHYBA: MODEL_N_THREADS='$MODEL_N_THREADS' není kladné celé číslo" >&2
                return 1 ;;
        esac
        echo "$MODEL_N_THREADS"
        return 0
    fi

    _quota=""
    _period=""
    if [ -r "$_root/cpu.max" ]; then
        read -r _quota _period < "$_root/cpu.max" || true
        [ "$_quota" = "max" ] && _quota=""
    elif [ -r "$_root/cpu/cpu.cfs_quota_us" ] && [ -r "$_root/cpu/cpu.cfs_period_us" ]; then
        _quota="$(cat "$_root/cpu/cpu.cfs_quota_us")"
        _period="$(cat "$_root/cpu/cpu.cfs_period_us")"
        [ "$_quota" = "-1" ] && _quota=""
    fi

    if [ -n "$_quota" ] && [ -n "$_period" ]; then
        case "$_quota$_period" in
            *[!0-9]*)
                echo "CHYBA: nečitelná CPU kvóta cgroup ('$_quota' / '$_period')" >&2
                return 1 ;;
        esac
        if [ "$_period" -gt 0 ]; then
            _n=$((_quota / _period))
            [ "$_n" -lt 1 ] && _n=1
            echo "$_n"
            return 0
        fi
    fi

    _n="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo "")"
    case "$_n" in
        ''|*[!0-9]*|0)
            echo "CHYBA: počet CPU nelze zjistit (nproc/getconf) a MODEL_N_THREADS není deklarováno" >&2
            return 1 ;;
    esac
    echo "$_n"
}
