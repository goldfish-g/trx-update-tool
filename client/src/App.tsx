import { useState, useCallback } from 'react';
import type { MappedFile, Language, GameVersion } from './converter/types.ts';
import { extractArchive, processFiles, filterByLanguage } from './converter/gamedata.ts';
import { setupCustomGameflow } from './converter/gameflow.ts';
import { createOutputZip } from './converter/zip.ts';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { LanguageSelect } from './components/LanguageSelect.tsx';
import { OutfitToggle } from './components/OutfitToggle.tsx';
import { Progress } from './components/Progress.tsx';
import { Result } from './components/Result.tsx';

type AppState =
  | { step: 'upload' }
  | { step: 'options'; entries: MappedFile[]; languages: Language[] }
  | { step: 'converting'; message: string; progress: number }
  | { step: 'uploading'; message: string; progress: number }
  | { step: 'done'; downloadUrl: string; expiresAt: string }
  | { step: 'error'; message: string };

const VERSION_MODS: Record<GameVersion, { modId: string; templateMod: string }> = {
  tr1: { modId: 'tr1-custom', templateMod: 'tr1-level' },
  tr2: { modId: 'tr2-custom', templateMod: 'tr2-level' },
  tr3: { modId: 'tr3-custom', templateMod: 'tr3-level' },
};

function detectGameVersion(entries: MappedFile[]): GameVersion {
  for (const entry of entries) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.phd')) return 'tr1';
    if (lower.endsWith('.tr2')) {
      const hasCuts = entries.some(e => e.path.toLowerCase().includes('cuts/'));
      const hasTR3Audio = entries.some(e => e.path.toLowerCase().endsWith('.wad'));
      if (hasCuts || hasTR3Audio) return 'tr3';
      return 'tr2';
    }
  }
  return 'tr2';
}

function App() {
  const [state, setState] = useState<AppState>({ step: 'upload' });
  const [gameVersion, setGameVersion] = useState<GameVersion>('tr2');
  const [useOutfitImport, setUseOutfitImport] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);

  const handleFilesSelected = useCallback(async (files: FileList) => {
    try {
      setState({ step: 'converting', message: 'Reading files...', progress: 0.1 });

      let entries: MappedFile[];

      if (files.length === 1) {
        const file = files[0];
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
          setState({ step: 'converting', message: 'Reading archive...', progress: 0.15 });
          const buf = await file.arrayBuffer();
          setState({ step: 'converting', message: 'Extracting...', progress: 0.3 });
          entries = extractArchive(new Uint8Array(buf), file.name);
        } else {
          throw new Error('Please upload a ZIP or tar.gz archive containing your game files.');
        }
      } else {
        entries = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const buf = await f.arrayBuffer();
          entries.push({ path, data: new Uint8Array(buf) });
        }
      }

      if (entries.length === 0) {
        throw new Error('No files found in the upload.');
      }

      const detected = detectGameVersion(entries);
      setGameVersion(detected);

      const { languages } = processFiles(entries, VERSION_MODS[detected].modId);

      setState({ step: 'options', entries, languages });
    } catch (err) {
      setState({ step: 'error', message: (err as Error).message || 'Failed to process files.' });
    }
  }, []);

  const handleStartConversion = useCallback(async (entries: MappedFile[]) => {
    try {
      await runConversion(entries, gameVersion, useOutfitImport, selectedLanguage ?? undefined);
    } catch (err) {
      setState({ step: 'error', message: (err as Error).message || 'Conversion failed.' });
    }
  }, [gameVersion, useOutfitImport, selectedLanguage]);

  async function runConversion(
    entries: MappedFile[],
    version: GameVersion,
    outfitImport: boolean,
    language: string | undefined,
  ) {
    setState({ step: 'converting', message: 'Mapping files...', progress: 0.5 });

    const { modId, templateMod } = VERSION_MODS[version];

    let filteredEntries = entries;
    if (language) {
      filteredEntries = filterByLanguage(entries, language);
    }

    const { mapped } = processFiles(filteredEntries, modId);

    if (mapped.length === 0) {
      throw new Error('No recognised game files found. Please provide your original Tomb Raider game files.');
    }

    setState({ step: 'converting', message: 'Generating gameflow...', progress: 0.65 });

    const finalFiles = setupCustomGameflow(mapped, modId, templateMod, outfitImport);

    setState({ step: 'converting', message: 'Creating ZIP...', progress: 0.8 });

    const zipData = createOutputZip(finalFiles);

    setState({ step: 'uploading', message: 'Uploading to server...', progress: 0.9 });

    const formData = new FormData();
    formData.append('file', new Blob([zipData as unknown as ArrayBuffer], { type: 'application/zip' }), `trx-${modId}.zip`);

    const res = await fetch('/api/store', { method: 'POST', body: formData });
    if (!res.ok) {
      throw new Error('Failed to store converted file on server.');
    }

    const { downloadUrl, expiresAt } = await res.json();

    setState({ step: 'done', downloadUrl, expiresAt });
  }

  const handleReset = useCallback(() => {
    setState({ step: 'upload' });
    setGameVersion('tr2');
    setUseOutfitImport(false);
    setSelectedLanguage(null);
  }, []);

  return (
    <div className="min-h-screen bg-base-200" data-theme="dark">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Header />

        {state.step === 'upload' && (
          <UploadZone onFilesSelected={handleFilesSelected} />
        )}

        {state.step === 'options' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body gap-6">
              <h2 className="card-title text-lg">Conversion Options</h2>

              <div className="alert alert-warning text-left">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="font-medium">This level uses a classic format that will be converted for the TRX engine.</p>
                  <p className="text-sm opacity-80 mt-1">This almost always works fine, but may sometimes introduce issues such as wrong level order, incorrect item names, missing music triggers, or other differences from the original game.</p>
                </div>
              </div>

              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Game Version (auto-detected)</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={gameVersion}
                  onChange={(e) => setGameVersion(e.target.value as GameVersion)}
                >
                  <option value="tr1">Tomb Raider I</option>
                  <option value="tr2">Tomb Raider II</option>
                  <option value="tr3">Tomb Raider III</option>
                </select>
              </div>

              {state.languages.length > 1 && (
                <LanguageSelect
                  languages={state.languages}
                  selected={selectedLanguage}
                  onSelect={setSelectedLanguage}
                />
              )}

              <OutfitToggle
                checked={useOutfitImport}
                onChange={setUseOutfitImport}
              />

              <div className="card-actions justify-end">
                <button className="btn btn-ghost" onClick={handleReset}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartConversion(state.entries)}
                >
                  Convert
                </button>
              </div>
            </div>
          </div>
        )}

        {(state.step === 'converting' || state.step === 'uploading') && (
          <Progress message={state.message} progress={state.progress} />
        )}

        {state.step === 'done' && (
          <Result
            downloadUrl={state.downloadUrl}
            expiresAt={state.expiresAt}
            onReset={handleReset}
          />
        )}

        {state.step === 'error' && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body items-center text-center gap-4">
              <div className="text-error text-5xl font-bold">!</div>
              <h2 className="card-title text-error">Something went wrong</h2>
              <p className="text-base-content/70">{state.message}</p>
              <button className="btn btn-primary" onClick={handleReset}>
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
