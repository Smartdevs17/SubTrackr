import sys
import os
import re
import json

# Setup paths
BENCHMARK_DIR = "gas-benchmarks"
BASELINE_PATH = os.path.join(BENCHMARK_DIR, "baseline.json")
TRENDS_PATH = os.path.join(BENCHMARK_DIR, "trends.json")
SVG_PATH = os.path.join(BENCHMARK_DIR, "gas_trend.svg")

os.makedirs(BENCHMARK_DIR, exist_ok=True)

# Regex patterns
pattern = re.compile(r'GAS_BENCHMARK:([^:]+):(.*)')
kv_pattern = re.compile(r'(\w+):\s*(\d+)')

current_results = {}
for line in sys.stdin:
    sys.stdout.write(line)
    match = pattern.search(line)
    if match:
        func_name = match.group(1)
        debug_str = match.group(2)
        kvs = kv_pattern.findall(debug_str)
        metrics = {k: int(v) for k, v in kvs}
        if metrics:
            current_results[func_name] = metrics

if not current_results:
    print("Error: No benchmark results parsed from test output. Make sure test_gas_benchmarks runs.", file=sys.stderr)
    sys.exit(1)

# Get commit metadata
commit_sha = os.environ.get("COMMIT_SHA", "unknown")
commit_time = int(os.environ.get("COMMIT_TIME", "0"))

# Load or generate baseline
baseline = {}
if os.path.exists(BASELINE_PATH):
    try:
        with open(BASELINE_PATH, "r") as f:
            baseline = json.load(f)
    except Exception as e:
        print(f"Warning: failed to load baseline: {e}", file=sys.stderr)

generate_baseline_mode = os.environ.get("GENERATE_BASELINE") == "true"
if generate_baseline_mode or not baseline:
    print(f"Saving current results as new baseline to {BASELINE_PATH}...")
    with open(BASELINE_PATH, "w") as f:
        json.dump(current_results, f, indent=2)
    baseline = current_results

# Load and update historical trends
trends = []
if os.path.exists(TRENDS_PATH):
    try:
        with open(TRENDS_PATH, "r") as f:
            trends = json.load(f)
    except Exception:
        pass

trends.append({
    "sha": commit_sha,
    "timestamp": commit_time,
    "results": current_results
})
trends = trends[-50:]
with open(TRENDS_PATH, "w") as f:
    json.dump(trends, f, indent=2)

# Generate trend SVG
def generate_svg(trends, svg_path):
    funcs = list(current_results.keys())
    funcs.sort(key=lambda fn: current_results.get(fn, {}).get("instructions", 0), reverse=True)
    plot_funcs = funcs[:5]
    
    width, height = 800, 400
    padding = 60
    
    points_by_func = {fn: [] for fn in plot_funcs}
    shas = []
    for t in trends[-10:]:
        shas.append(t["sha"])
        for fn in plot_funcs:
            val = t.get("results", {}).get(fn, {}).get("instructions", 0)
            points_by_func[fn].append(val)
            
    if not shas:
        return
        
    max_val = max(max(vals) if vals else 0 for vals in points_by_func.values())
    max_val = max(max_val, 1)
    
    colors = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"]
    
    svg = []
    svg.append(f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" style="background:#0f172a; font-family:sans-serif; border-radius:8px;">')
    svg.append(f'<text x="20" y="30" fill="#f8fafc" font-size="16" font-weight="bold">Gas Consumption Trends (CPU Instructions)</text>')
    
    for i in range(5):
        y = padding + i * (height - 2 * padding) // 4
        val = int(max_val - i * max_val / 4)
        svg.append(f'<line x1="{padding}" y1="{y}" x2="{width - padding}" y2="{y}" stroke="#334155" stroke-dasharray="4,4"/>')
        svg.append(f'<text x="{padding - 10}" y="{y + 4}" fill="#94a3b8" font-size="10" text-anchor="end">{val:,}</text>')
        
    num_commits = len(shas)
    x_step = (width - 2 * padding) / max(num_commits - 1, 1)
    for idx, sha in enumerate(shas):
        x = padding + idx * x_step
        svg.append(f'<text x="{x}" y="{height - padding + 20}" fill="#94a3b8" font-size="10" text-anchor="middle">{sha}</text>')
        
    for fn_idx, fn in enumerate(plot_funcs):
        vals = points_by_func[fn]
        color = colors[fn_idx % len(colors)]
        
        path_data = []
        for idx, val in enumerate(vals):
            x = padding + idx * x_step
            y = height - padding - (val / max_val) * (height - 2 * padding)
            path_data.append(f"{'M' if idx == 0 else 'L'} {x:.1f} {y:.1f}")
            svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}"/>')
            
        if path_data:
            svg.append(f'<path d="{" ".join(path_data)}" fill="none" stroke="{color}" stroke-width="2"/>')
            
        leg_x = width - padding - 180
        leg_y = padding + fn_idx * 20
        svg.append(f'<rect x="{leg_x}" y="{leg_y - 8}" width="12" height="12" fill="{color}" rx="2"/>')
        svg.append(f'<text x="{leg_x + 18}" y="{leg_y + 2}" fill="#e2e8f0" font-size="10">{fn}</text>')
        
    svg.append('</svg>')
    
    with open(svg_path, "w") as f:
        f.write("\n".join(svg))

try:
    generate_svg(trends, SVG_PATH)
except Exception as e:
    print(f"Warning: failed to generate SVG: {e}", file=sys.stderr)

# Regressions analysis
threshold = float(os.environ.get("GAS_REGRESSION_THRESHOLD", "0.10"))
regressions = []
summary_table = []
call_trees = []

summary_table.append("| Function | Baseline (CPU) | Current (CPU) | Change | Status |")
summary_table.append("| --- | --- | --- | --- | --- |")

for func, metrics in current_results.items():
    current_cpu = metrics.get("instructions", 0)
    baseline_metrics = baseline.get(func, {})
    baseline_cpu = baseline_metrics.get("instructions", 0)
    
    change_pct = 0.0
    change_str = "0.0%"
    status = "✅ Pass"
    
    if baseline_cpu > 0:
        change_pct = (current_cpu - baseline_cpu) / baseline_cpu
        change_str = f"{change_pct * 100:+.2f}%"
        if change_pct > threshold:
            status = "⚠️ Regression"
            regressions.append((func, baseline_cpu, current_cpu, change_pct))
        elif change_pct < -0.01:
            status = "⚡ Optimized"
    else:
        change_str = "New"
        
    summary_table.append(f"| `{func}` | {baseline_cpu:,} | {current_cpu:,} | {change_str} | {status} |")
    
    # Stratified Call Tree
    mem = metrics.get("mem_bytes", 0)
    reads = metrics.get("disk_read_entries", 0) or metrics.get("read_entries", 0) or 0
    writes = metrics.get("write_entries", 0) or 0
    write_b = metrics.get("write_bytes", 0) or 0
    
    est_read_cost = reads * 12000
    est_write_cost = writes * 25000 + write_b * 30
    total_est_storage = est_read_cost + est_write_cost
    
    wasm_cost = current_cpu - total_est_storage
    min_wasm = int(current_cpu * 0.15)
    if wasm_cost < min_wasm:
        wasm_cost = min_wasm
        remaining = current_cpu - wasm_cost
        if total_est_storage > 0:
            est_read_cost = int(est_read_cost * remaining / total_est_storage)
            est_write_cost = int(est_write_cost * remaining / total_est_storage)
        else:
            wasm_cost = current_cpu
            
    other_host = current_cpu - wasm_cost - est_read_cost - est_write_cost
    if other_host < 0:
        other_host = 0
        
    p_wasm = (wasm_cost / current_cpu) * 100 if current_cpu > 0 else 0
    p_read = (est_read_cost / current_cpu) * 100 if current_cpu > 0 else 0
    p_write = (est_write_cost / current_cpu) * 100 if current_cpu > 0 else 0
    p_other = (other_host / current_cpu) * 100 if current_cpu > 0 else 0
    
    tree = f"""**`{func}`** (Total: {current_cpu:,} CPU instructions, {mem:,} Bytes RAM)
├── **WASM Execution**: {wasm_cost:,} CPU ({p_wasm:.1f}%)
├── **Storage Reads**: {est_read_cost:,} CPU ({p_read:.1f}%) [{reads} entry reads]
├── **Storage Writes**: {est_write_cost:,} CPU ({p_write:.1f}%) [{writes} entry writes, {write_b} bytes]
└── **Host/Auth/Events**: {other_host:,} CPU ({p_other:.1f}%)"""
    call_trees.append(tree)

print("\n" + "="*50)
print("             SOROBAN GAS BENCHMARK REPORT             ")
print("="*50)
for r in summary_table:
    print(r)
print("\n" + "="*50)
print("             STRATIFIED CALL TREES                    ")
print("="*50)
for t in call_trees:
    print(t)
    print()

step_summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
if step_summary_file:
    with open(step_summary_file, "w") as sf:
        sf.write("## ⛽ Soroban Smart Contract Gas Profiling\n\n")
        
        if regressions:
            sf.write("### ⚠️ Gas Cost Regressions Detected!\n")
            sf.write(f"The following functions exceeded the baseline by more than the threshold of **{threshold*100:.0f}%**:\n\n")
            for name, base, cur, pct in regressions:
                sf.write(f"- **`{name}`**: {base:,} -> {cur:,} (**{pct*100:+.2f}%**)\n")
            sf.write("\n")
        else:
            sf.write("### ✅ All Gas Benchmarks Passed\n")
            sf.write("No gas regressions detected against baseline.\n\n")
            
        sf.write("### 📊 Performance Summary\n")
        sf.write("\n".join(summary_table) + "\n\n")
        
        sf.write("### 📈 Gas Consumption Trends\n")
        sf.write(f"![Gas Consumption Trends](https://raw.githubusercontent.com/rindicomfort/SubTrackr/feat/gas-profiling-pipeline/gas-benchmarks/gas_trend.svg)\n\n")
        
        sf.write("### 🌳 Stratified Call Trees\n")
        sf.write("Identifies high-cost operations per function:\n\n")
        for t in call_trees:
            sf.write("```text\n" + t + "\n```\n\n")

if regressions:
    print(f"\n❌ Fail: {len(regressions)} gas cost regressions detected!", file=sys.stderr)
    sys.exit(1)
else:
    print("\n✅ Success: All gas benchmarks within baseline limits.")
    sys.exit(0)
