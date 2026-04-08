
import os

target_file = '/Users/op_maulana/unifleet2/src/components/EfficiencyMap.tsx'

with open(target_file, 'r') as f:
    lines = f.readlines()

# 1. Enhance Insights Logic
# We'll replace the block where we push timeInsight
# Look for: "if (timeInsight) insights.push(timeInsight);"
# And add distribution insights after it.

new_insights_block = """            if (timeInsight) insights.push(timeInsight);

            // Distribution Insights
            if (hasDistribution) {
                insights.push(`50% of visits were shorter than ${median.toFixed(0)}h`);
                insights.push(`Longest 10% exceeded ${p90.toFixed(0)}h`);
                if (maxD > p90 * 2) insights.push(`Extreme outlier: ${maxD.toFixed(0)}h`);
            }
"""

replacement_idx = -1
for i, line in enumerate(lines):
    if "if (timeInsight) insights.push(timeInsight);" in line:
        replacement_idx = i
        break

if replacement_idx != -1:
    if "Distribution Insights" not in lines[replacement_idx+1]:
        lines[replacement_idx] = new_insights_block
        print("Patched Insights Logic")
    else:
        print("Insights Logic already patched")

# 2. Enhance Variability Tooltip
# Look for: title="Standard Deviation: Measures duration variability. Lower is better."
# We'll replace the whole span with a better one.

tooltip_search = '<span title="Standard Deviation: Measures duration variability. Lower is better.">σ: ${stddev.toFixed(1)}h <span style="color:#94a3b8;">(?)</span></span>'
tooltip_replace = """<div title="Standard Deviation (σ) measures operational consistency. \n• Low: Predictable durations\n• High: Unpredictable delays" style="cursor:help;border-bottom:1px dashed #94a3b8;display:inline-block;">
                            σ: ${stddev.toFixed(1)}h <span style="font-size:7px;color:#64748b;vertical-align:top;">INFO</span>
                        </div>"""

for i, line in enumerate(lines):
    if 'title="Standard Deviation:' in line:
        lines[i] = lines[i].replace(tooltip_search.strip(), tooltip_replace.strip()) # Be careful with strip/replace
        # Actually exact string match might fail due to whitespace in my previous patch vs current file
        # I'll use a simpler replace based on unique substring
        pass

# Re-implementing step 2 with safer logic
found_tooltip = False
for i, line in enumerate(lines):
    if '<span title="Standard Deviation:' in line:
        # Replace the entire line or the specific span
        # The line likely contains: <span title="...">σ: ... (?)</span></span>
        # We'll replace the inner content
        lines[i] = """                        <div title="Standard Deviation (σ) measures operational consistency. Low σ = predictable; High σ = variable." style="cursor:help;display:flex;align-items:center;gap:4px;">
                            <span>σ: ${stddev.toFixed(1)}h</span>
                            <div style="background:#e2e8f0;color:#64748b;font-size:7px;padding:1px 3px;border-radius:2px;">WHAT IS THIS?</div>
                        </div>
"""
        found_tooltip = True
        break

if found_tooltip:
    with open(target_file, 'w') as f:
        f.writelines(lines)
    print("SUCCESS")
else:
    print("FAILED to find tooltip line")
