const STEPS = ["Upload", "Review", "Translate", "Export"] as const;

export default function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center justify-center gap-2 sm:gap-4">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li
              key={label}
              className="flex items-center gap-2 sm:gap-4"
              aria-current={state === "active" ? "step" : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                    (state === "done"
                      ? "bg-blue-600 text-white"
                      : state === "active"
                        ? "border-2 border-blue-600 bg-white text-blue-600"
                        : "border border-slate-300 bg-white text-slate-500")
                  }
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={
                    "hidden text-sm sm:inline " +
                    (state === "active"
                      ? "font-medium text-slate-800"
                      : "text-slate-500")
                  }
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span className="h-px w-6 bg-slate-300 sm:w-10" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
