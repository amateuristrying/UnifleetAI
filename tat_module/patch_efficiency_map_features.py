
import os
import re

target_file = '/Users/op_maulana/unifleet2/src/components/EfficiencyMap.tsx'

with open(target_file, 'r') as f:
    original_content = f.read()

content = original_content

# 1. Imports
if "import HexReportModal" not in content:
    import_stmt = "import HexReportModal from './HexReportModal';"
    # Use re to match import line regardless of exact position if needed, but strings are safe here
    content = content.replace("import { Vehicle } from '@/types/telemetry';", "import { Vehicle } from '@/types/telemetry';\n" + import_stmt)

# 2. State
if "setSelectedHexReport" not in content:
    state_stmt = "    const [selectedHexReport, setSelectedHexReport] = useState<{ id: string, name: string } | null>(null);"
    content = content.replace("const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/streets-v12');", "const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/streets-v12');\n" + state_stmt)

# 3. Layer Style (Variable Radius)
# Current: 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 16, 8]
# Regex to match loose spacing
radius_pattern = r"'circle-radius':\s*\[\s*'interpolate',\s*\[\s*'linear'\s*\],\s*\[\s*'zoom'\s*\],\s*10,\s*2,\s*14,\s*4,\s*16,\s*8\s*\]"
new_radius = "'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['interpolate', ['linear'], ['get', 'duration'], 0, 2, 100, 6], 15, ['interpolate', ['linear'], ['get', 'duration'], 0, 4, 24, 12, 100, 24]]"

content = re.sub(radius_pattern, new_radius, content)

# 4. Popup HTML Footer
# Match <span>Total Dwell...</span> followed by closing div
footer_pattern = r'<span>Total Dwell: \${totalDwell\.toFixed\(0\)}h</span>\s*</div>'
buttons_html = """<span>Total Dwell: ${totalDwell.toFixed(0)}h</span>
                    </div>
                    
                    <!-- Report Actions -->
                    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;display:flex;gap:6px;">
                        <button id="btn-view-report" style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;padding:6px;border-radius:4px;font-size:9px;font-weight:700;color:#475569;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.2s;">
                            📄 View Report
                        </button>
                        <button id="btn-download-report" style="flex:1;background:#0f172a;border:1px solid #0f172a;padding:6px;border-radius:4px;font-size:9px;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.2s;">
                            ⬇ Download
                        </button>
                    </div>"""

# Replace only the first occurrence (should be unique in the html string context)
content = re.sub(footer_pattern, buttons_html, content, count=1)

# 5. Popup Logic (setDOMContent)
set_html_marker = "popupInstance.setHTML(html);"
new_set_logic = """
            // Convert to DOM for event listeners
            const container = document.createElement('div');
            container.innerHTML = html;

            const btnView = container.querySelector('#btn-view-report');
            const btnDown = container.querySelector('#btn-download-report');

            if (btnView) {
                btnView.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setSelectedHexReport({ id: props.h3Index, name: address });
                });
            }

            if (btnDown) {
                btnDown.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget; // Typed as any to avoid TS issues in this simplified script
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '⏳ Downloading...';
                    btn.style.opacity = '0.7';
                    
                    try {
                        const { data, error } = await supabase.rpc('get_hex_details', {
                            p_h3_index: props.h3Index,
                            min_date: dateRange.start,
                            max_date: dateRange.end,
                            tracker_id_filter: trackerFilter,
                            p_limit: 10000 
                        });

                        if (error) throw error;
                        if (!data || data.length === 0) {
                            alert('No data to download');
                            return;
                        }

                        // Generate CSV
                        const headers = ['Vehicle ID', 'Arrival', 'Departure', 'Duration (h)', 'Engine On (h)', 'Engine Off (h)', 'Ignition %', 'Risk Score'];
                        const rows = data.map(row => [
                            row.vehicle_id,
                            row.visit_start,
                            row.visit_end,
                            row.duration_hours?.toFixed(2),
                            row.engine_on_hours?.toFixed(2),
                            row.engine_off_hours?.toFixed(2),
                            row.ignition_on_percent?.toFixed(1) + '%',
                            row.risk_score?.toFixed(1)
                        ]);
                        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        const url = URL.createObjectURL(blob);
                        link.setAttribute('href', url);
                        link.setAttribute('download', `hex_report_${props.h3Index}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                    } catch (err) {
                        console.error('Download failed', err);
                        alert('Download failed');
                    } finally {
                        btn.innerHTML = originalText;
                        btn.style.opacity = '1';
                    }
                });
            }

            popupInstance.setDOMContent(container);
"""

if set_html_marker in content:
    content = content.replace(set_html_marker, new_set_logic)

# 6. Render Modal
# Matched from file view: <div ref={mapContainer} className="w-full h-full" />
map_container_marker = '<div ref={mapContainer} className="w-full h-full" />'
modal_jsx = """            <div ref={mapContainer} className="w-full h-full" />
            
            {/* Report Modal */}
            <HexReportModal 
                isOpen={!!selectedHexReport}
                onClose={() => setSelectedHexReport(null)}
                hexId={selectedHexReport?.id || ''}
                locationName={selectedHexReport?.name}
                filters={{
                    dateRange,
                    trackerId: trackerFilter
                }}
            />
"""

if map_container_marker in content:
    content = content.replace(map_container_marker, modal_jsx)
else:
    print("WARNING: Could not find mapContainer div.")

# Write back
if content != original_content:
    with open(target_file, 'w') as f:
        f.write(content)
    print("SUCCESS")
else:
    print("NO CHANGES MADE")
