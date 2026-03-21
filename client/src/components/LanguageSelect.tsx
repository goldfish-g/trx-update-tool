import type { Language } from '../converter/types.ts';

type Props = {
  languages: Language[];
  selected: string | null;
  onSelect: (code: string) => void;
};

export function LanguageSelect({ languages, selected, onSelect }: Props) {
  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text">Audio Language</span>
      </label>
      <p className="text-sm text-base-content/50 mb-2">
        Multiple audio languages detected. Select the one to include.
      </p>
      <div className="flex flex-wrap gap-2">
        {languages.map((lang) => (
          <button
            key={lang.code}
            className={`btn btn-sm ${
              selected === lang.code ? 'btn-primary' : 'btn-outline'
            }`}
            onClick={() => onSelect(lang.code)}
          >
            {lang.name}
          </button>
        ))}
      </div>
    </div>
  );
}
