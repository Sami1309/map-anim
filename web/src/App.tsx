import { useState } from "react";
import "./styles.css";
import MapPreview from "./MapPreview";
import { resolveProgram, renderProgram, saveTemplate } from "./api";
import type { MapProgram } from "./types";
import { MAP_STYLES, MAP_SETTINGS, DEFAULT_ANIMATION_SETTINGS, FAST_ANIMATION_SETTINGS } from "./constants";
import { getDefaultMapSettings, mergeAnimationSettings } from "./map-settings.js";

export default function App() {
  const [prompt, setPrompt] = useState("Fly from Europe to Spain in 4 seconds, end pitch 40°, highlight Spain border 6px, 1280×720 @30fps");
  const [program, setProgram] = useState<MapProgram | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"flexible" | "16:9" | "9:16">("flexible");
  const [selectedStyleUrl, setSelectedStyleUrl] = useState(MAP_STYLES[0].url);
  const [mapSettings, setMapSettings] = useState(getDefaultMapSettings());
  const [animationSettings, setAnimationSettings] = useState(DEFAULT_ANIMATION_SETTINGS);
  const [renderProgress, setRenderProgress] = useState<string | null>(null);
  const [showCodeView, setShowCodeView] = useState(false);
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  // New controls
  const [address, setAddress] = useState("");
  const [regionName, setRegionName] = useState("");
  const [phaseHighlight, setPhaseHighlight] = useState(false);
  const [phaseTrace, setPhaseTrace] = useState(false);
  const [phaseHold, setPhaseHold] = useState(false);
  const [phaseWait, setPhaseWait] = useState(false);
  const [terrain, setTerrain] = useState(false);
  const [google3dEnabled, setGoogle3dEnabled] = useState(false);
  const [google3dKey, setGoogle3dKey] = useState<string>(() => localStorage.getItem('GOOGLE_TILE_API_KEY') || "");


  function buildOverrides() {
    const extras: any = {};
    if (address.trim()) extras.address = address.trim();
    if (regionName.trim()) extras.boundaryName = regionName.trim();
    const phases: string[] = ['zoom'];
    if (phaseHighlight) phases.push('highlight');
    if (phaseTrace) phases.push('trace');
    if (phaseWait) phases.push('wait');
    if (phaseHold) phases.push('hold');
    const flags: any = {};
    if (terrain) flags.terrain = true;
    if (google3dEnabled && google3dKey) flags.google3dApiKey = google3dKey;
    const animation: any = { phases };
    const override: any = { extras, animation, flags };
    // style the user chose
    if (selectedStyleUrl) override.style = selectedStyleUrl;
    return override;
  }

  async function onGenerate() {
    setBusy(true);
    setRenderProgress("Generating program...");
    try {
      let resolved;
      if (advancedEnabled) {
        const override = buildOverrides();
        resolved = await resolveProgram({ text: prompt, program: override });
      } else {
        resolved = await resolveProgram({ text: prompt });
      }
      const enhancedProg = mergeAnimationSettings(resolved, animationSettings);
      setProgram(enhancedProg);
      setVideoUrl(null);
    } catch (e: any) {
      try {
        const msg = typeof e?.message === 'string' ? e.message : String(e);
        // If server sent JSON, surface its error/details
        let display = msg;
        if (msg.startsWith('{')) {
          const obj = JSON.parse(msg);
          display = obj.error || obj.details || msg;
        }
        setRenderProgress(`Error: ${display}`);
      } catch {
        setRenderProgress('Error generating program');
      }
      setTimeout(() => setRenderProgress(null), 4000);
    } finally {
      setBusy(false);
      setRenderProgress(null);
    }
  }

  async function onPlay() {
    await (window as any).__playPreview?.();
  }

  async function onRender() {
    if (!program) return;
    setBusy(true);
    setRenderProgress("Rendering video...");
    try {
      // Apply current animation settings before rendering
      const enhancedProgram = mergeAnimationSettings(program, animationSettings);
      const { url } = await renderProgram(enhancedProgram);
      setVideoUrl(url);
      setRenderProgress("Render complete!");
      setTimeout(() => setRenderProgress(null), 2000);
    } catch (e: any) {
      try {
        const msg = typeof e?.message === 'string' ? e.message : String(e);
        let display = msg;
        if (msg.startsWith('{')) {
          const obj = JSON.parse(msg);
          display = obj.error || obj.details || msg;
        }
        setRenderProgress(`Render failed: ${display}`);
      } catch {
        setRenderProgress('Render failed');
      }
      setTimeout(() => setRenderProgress(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTemplate() {
    if (!program) return;
    const name = prompt.slice(0, 40).replace(/[^\w-]+/g, "_") || "template";
    // download locally
    const blob = new Blob([JSON.stringify(program, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.json`; link.click();

    // also send to backend storage (optional)
    try { await saveTemplate(name, program); } catch {}
  }

  // editor functions
  function setStroke(w: number) { if (!program) return; setProgram({ ...program, border: { ...program.border, strokeWidth: w } }); }
  function setIso(iso: string) { if (!program) return; setProgram({ ...program, border: { ...program.border, isoA3: iso.toUpperCase() } }); }
  
  function updateMapSetting(key: string, value: any) {
    setMapSettings(prev => ({ ...prev, [key]: value }));
  }

  function toggleFastMode() {
    const newSettings = animationSettings.fastMode ? DEFAULT_ANIMATION_SETTINGS : FAST_ANIMATION_SETTINGS;
    setAnimationSettings(newSettings);
    // Update existing program if present
    if (program) {
      setProgram(mergeAnimationSettings(program, newSettings));
    }
  }

  async function handleStyleChange(url: string) {
    setSelectedStyleUrl(url);
    
    // Warn about MapTiler styles that are backend-only (direct API calls)
    if (url.includes('api.maptiler.com') && url.includes('{key}')) {
      alert('This style is optimized for backend rendering. Preview will work, but final render will have higher quality.');
    }
    // Re-resolve the current program with the chosen style so backend injects keys/CORS-safe data URL
    if (program) {
      setBusy(true);
      setRenderProgress("Updating style...");
      try {
        const next = await resolveProgram({ program: { ...program, style: url } as any });
        // Preserve client-side animation settings
        const enhanced = mergeAnimationSettings(next, animationSettings);
        setProgram(enhanced);
      } catch (e) {
        console.error('Style resolve failed', e);
      } finally {
        setBusy(false);
        setRenderProgress(null);
      }
    }
  }

  return (
    <div className="layout">
      <div className="left">
        <h1>Map Animation Studio</h1>
        <label>Prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} />
        <div className="row">
          <button onClick={onGenerate} disabled={busy}>
            {renderProgress && renderProgress.includes("Generating") ? "Generating..." : "Generate"}
          </button>
          <button onClick={onPlay} disabled={!program || busy}>Play</button>
          <button onClick={onRender} disabled={!program || busy}>
            {renderProgress && renderProgress.includes("Rendering") ? "Rendering..." : "Render"}
          </button>
        </div>

        {renderProgress && (
          <div className="progress">
            <div className="progress-text">{renderProgress}</div>
            {busy && <div className="progress-bar"><div className="progress-indicator"></div></div>}
          </div>
        )}

        <h3>Map Style</h3>
        <div className="cfg">
          <label>Style</label>
          <select value={selectedStyleUrl} onChange={e => handleStyleChange(e.target.value)}>
            {MAP_STYLES.map(style => (
              <option key={style.url} value={style.url} title={style.description}>
                {style.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => setAdvancedEnabled(v => !v)}>
            {advancedEnabled ? 'Hide Advanced Controls' : 'Show Advanced Controls'}
          </button>
        </div>

        {advancedEnabled && (
          <>
            <h3>Address / Region</h3>
            <div className="cfg">
              <label>Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="1600 Amphitheatre Pkwy, Mountain View" />
              <label>Region name</label>
              <input value={regionName} onChange={e => setRegionName(e.target.value)} placeholder="Detroit" />
            </div>

            <h3>Phases</h3>
            <div className="cfg">
              <label className="checkbox"><input type="checkbox" checked={phaseHighlight} onChange={e => setPhaseHighlight(e.target.checked)} /> Highlight</label>
              <label className="checkbox"><input type="checkbox" checked={phaseTrace} onChange={e => setPhaseTrace(e.target.checked)} /> Trace</label>
              <label className="checkbox"><input type="checkbox" checked={phaseWait} onChange={e => setPhaseWait(e.target.checked)} /> Wait</label>
              <label className="checkbox"><input type="checkbox" checked={phaseHold} onChange={e => setPhaseHold(e.target.checked)} /> Hold</label>
            </div>

            <h3>3D / Terrain</h3>
            <div className="cfg">
              <label className="checkbox"><input type="checkbox" checked={terrain} onChange={e => setTerrain(e.target.checked)} /> Terrain + Sky</label>
              <label className="checkbox"><input type="checkbox" checked={google3dEnabled} onChange={e => setGoogle3dEnabled(e.target.checked)} /> Google Photorealistic 3D Tiles</label>
              <label>Google Tile API Key</label>
              <input value={google3dKey} onChange={e => { setGoogle3dKey(e.target.value); localStorage.setItem('GOOGLE_TILE_API_KEY', e.target.value); }} placeholder="AIza..." />
            </div>
          </>
        )}

        <h3>Animation Settings</h3>
        <div className="cfg">
          <label>Fast Mode</label>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={animationSettings.fastMode}
              onChange={toggleFastMode}
            />
            <span className="slider"></span>
          </label>
          <label>Trace Duration (ms)</label>
          <input 
            type="number" 
            min={500} 
            max={10000} 
            step={250}
            value={animationSettings.traceDuration}
            onChange={e => setAnimationSettings(prev => ({ ...prev, traceDuration: parseInt(e.target.value) }))}
          />
        </div>

        <h3>Map Settings</h3>
        <div className="cfg">
          {MAP_SETTINGS.map(setting => (
            <div key={setting.key} className="cfg-row">
              <label>{setting.name}</label>
              {setting.type === 'boolean' ? (
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={mapSettings[setting.key] || false}
                    onChange={e => updateMapSetting(setting.key, e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              ) : setting.type === 'select' ? (
                <select
                  value={mapSettings[setting.key] || setting.defaultValue}
                  onChange={e => updateMapSetting(setting.key, e.target.value)}
                >
                  {setting.options?.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={mapSettings[setting.key] || setting.defaultValue}
                  onChange={e => updateMapSetting(setting.key, parseInt(e.target.value))}
                />
              )}
            </div>
          ))}
        </div>

        <h3>Border Configuration</h3>
        <div className="cfg">
          <label>Border ISO3</label>
          <input value={program?.border.isoA3 || ""} onChange={e => setIso(e.target.value)} />
          <label>Border Width</label>
          <input type="number" min={1} max={20}
            value={program?.border.strokeWidth ?? 4} onChange={e => setStroke(parseInt(e.target.value || "4", 10))} />
          <label>Aspect Ratio</label>
          <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value as "flexible" | "16:9" | "9:16")}>
            <option value="flexible">Flexible</option>
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
          </select>
        </div>

        <div className="row">
          <button onClick={onSaveTemplate} disabled={!program}>Save as Template</button>
          <button 
            onClick={() => setShowCodeView(!showCodeView)} 
            disabled={!program}
            className={showCodeView ? "active" : ""}
          >
            {showCodeView ? "Hide Code" : "View Code"}
          </button>
        </div>

        {showCodeView && program && (
          <div className="code-view">
            <h3>Generated Program Code</h3>
            <div className="code-container">
              <pre className="code-block">{JSON.stringify(program, null, 2)}</pre>
            </div>
          </div>
        )}

        {videoUrl && (
          <>
            <h3>Rendered Video</h3>
            <video src={videoUrl} controls style={{ width: "100%" }} />
            <p><a href={videoUrl} target="_blank">Open video</a></p>
          </>
        )}
      </div>

      <div className="right">
        <MapPreview program={program} aspectRatio={aspectRatio} mapSettings={mapSettings} />
      </div>
    </div>
  );
}
