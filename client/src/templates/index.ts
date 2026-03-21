// TR1 level templates
import tr1GameflowRaw from './tr1-level/gameflow.json5?raw';
import tr1StringsRaw from './tr1-level/strings.json5?raw';
import tr1StringsDeRaw from './tr1-level/strings-de.json5?raw';
import tr1StringsFrRaw from './tr1-level/strings-fr.json5?raw';
import tr1StringsGdRaw from './tr1-level/strings-gd.json5?raw';
import tr1StringsItRaw from './tr1-level/strings-it.json5?raw';
import tr1StringsPlRaw from './tr1-level/strings-pl.json5?raw';
import tr1StringsRuRaw from './tr1-level/strings-ru.json5?raw';

// TR2 level templates
import tr2GameflowRaw from './tr2-level/gameflow.json5?raw';
import tr2StringsRaw from './tr2-level/strings.json5?raw';
import tr2StringsDeRaw from './tr2-level/strings-de.json5?raw';
import tr2StringsFrRaw from './tr2-level/strings-fr.json5?raw';
import tr2StringsGdRaw from './tr2-level/strings-gd.json5?raw';
import tr2StringsItRaw from './tr2-level/strings-it.json5?raw';
import tr2StringsPlRaw from './tr2-level/strings-pl.json5?raw';

// TR3 level templates
import tr3GameflowRaw from './tr3-level/gameflow.json5?raw';
import tr3StringsRaw from './tr3-level/strings.json5?raw';
import tr3StringsItRaw from './tr3-level/strings-it.json5?raw';
import tr3StringsPlRaw from './tr3-level/strings-pl.json5?raw';

// Cfg files
import cfgOutfitsRaw from './cfg/outfits.json5?raw';
import cfgBaseStringsRaw from './cfg/base_strings.json5?raw';
import cfgBaseStringsDeRaw from './cfg/base_strings-de.json5?raw';
import cfgBaseStringsEnGbRaw from './cfg/base_strings-en-gb.json5?raw';
import cfgBaseStringsFrRaw from './cfg/base_strings-fr.json5?raw';
import cfgBaseStringsGdRaw from './cfg/base_strings-gd.json5?raw';
import cfgBaseStringsItRaw from './cfg/base_strings-it.json5?raw';
import cfgBaseStringsPlRaw from './cfg/base_strings-pl.json5?raw';
import cfgBaseStringsRuRaw from './cfg/base_strings-ru.json5?raw';

const templateMods: Record<string, Record<string, string>> = {
  'tr1-level': {
    'gameflow.json5': tr1GameflowRaw,
    'strings.json5': tr1StringsRaw,
    'strings-de.json5': tr1StringsDeRaw,
    'strings-fr.json5': tr1StringsFrRaw,
    'strings-gd.json5': tr1StringsGdRaw,
    'strings-it.json5': tr1StringsItRaw,
    'strings-pl.json5': tr1StringsPlRaw,
    'strings-ru.json5': tr1StringsRuRaw,
  },
  'tr2-level': {
    'gameflow.json5': tr2GameflowRaw,
    'strings.json5': tr2StringsRaw,
    'strings-de.json5': tr2StringsDeRaw,
    'strings-fr.json5': tr2StringsFrRaw,
    'strings-gd.json5': tr2StringsGdRaw,
    'strings-it.json5': tr2StringsItRaw,
    'strings-pl.json5': tr2StringsPlRaw,
  },
  'tr3-level': {
    'gameflow.json5': tr3GameflowRaw,
    'strings.json5': tr3StringsRaw,
    'strings-it.json5': tr3StringsItRaw,
    'strings-pl.json5': tr3StringsPlRaw,
  },
};

const cfgFiles: Record<string, string> = {
  'outfits.json5': cfgOutfitsRaw,
  'base_strings.json5': cfgBaseStringsRaw,
  'base_strings-de.json5': cfgBaseStringsDeRaw,
  'base_strings-en-gb.json5': cfgBaseStringsEnGbRaw,
  'base_strings-fr.json5': cfgBaseStringsFrRaw,
  'base_strings-gd.json5': cfgBaseStringsGdRaw,
  'base_strings-it.json5': cfgBaseStringsItRaw,
  'base_strings-pl.json5': cfgBaseStringsPlRaw,
  'base_strings-ru.json5': cfgBaseStringsRuRaw,
};

export function getTemplate(templateMod: string, filename: string): string {
  const mod = templateMods[templateMod];
  if (!mod) {
    throw new Error(`Unknown template mod: ${templateMod}`);
  }
  const content = mod[filename];
  if (content === undefined) {
    throw new Error(
      `Unknown template file '${filename}' in mod '${templateMod}'`,
    );
  }
  return content;
}

export function getTemplateFiles(templateMod: string): string[] {
  const mod = templateMods[templateMod];
  if (!mod) {
    throw new Error(`Unknown template mod: ${templateMod}`);
  }
  return Object.keys(mod);
}

export function getCfgFile(filename: string): string {
  const content = cfgFiles[filename];
  if (content === undefined) {
    throw new Error(`Unknown cfg file: ${filename}`);
  }
  return content;
}

export function getCfgFiles(): string[] {
  return Object.keys(cfgFiles);
}
