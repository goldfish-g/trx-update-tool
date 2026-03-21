type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
};

export function OutfitToggle({ checked, onChange }: Props) {
  return (
    <div className="form-control bg-base-200 rounded-lg p-4">
      <label className="label cursor-pointer justify-start gap-3">
        <input
          type="checkbox"
          className="checkbox checkbox-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="label-text font-medium">Import outfit from level file</span>
      </label>
      <p className="text-sm text-base-content/50 mt-1 ml-10">
        Uses the Lara model embedded in the level file instead of the default TRX outfit.
        This is usually fine, but depending on the level, it may cause some issues with the
        braid, incorrect holsters, or other visual artifacts.
      </p>
    </div>
  );
}
