import { useState } from "react";
import "./styles.css";
import MapPreview from "./MapPreview";
import { parsePrompt, renderProgram, saveTemplate } from "./api";
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


  async function onGenerate() {
    setBusy(true);
    setRenderProgress("Generating program...");
    try {
      const prog = await parsePrompt(prompt);
      // Use selected style URL instead of default
      prog.style = selectedStyleUrl;
      // Apply animation settings
      const enhancedProg = mergeAnimationSettings(prog, animationSettings);
      setProgram(enhancedProg);
      setVideoUrl(null);
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
    } catch (error) {
      setRenderProgress("Render failed");
      setTimeout(() => setRenderProgress(null), 3000);
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

  function handleStyleChange(url: string) {
    setSelectedStyleUrl(url);
    
    // Warn about MapTiler styles that are backend-only (direct API calls)
    if (url.includes('api.maptiler.com') && url.includes('{key}')) {
      alert('This style is optimized for backend rendering. Preview will work, but final render will have higher quality.');
    }
    
    if (program) {
      setProgram({ ...program, style: url });
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