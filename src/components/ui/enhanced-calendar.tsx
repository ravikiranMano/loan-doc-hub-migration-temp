import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format, addMonths, subMonths, setMonth, setYear, isValid } from "date-fns";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { parseDateOnly } from "@/lib/dateOnly";


export type EnhancedCalendarProps = React.ComponentProps<typeof DayPicker> & {
  onClear?: () => void;
  onToday?: () => void;
  showClearToday?: boolean;
  /** Earliest selectable year (default: currentYear - 120). */
  fromYear?: number;
  /** Latest selectable year (default: currentYear + 10). */
  toYear?: number;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Coerce anything (Date | string | number | undefined) into a valid Date. */
function toSafeDate(v: unknown, fallback: Date): Date {
  if (v instanceof Date && isValid(v)) return v;
  if (typeof v === "string") {
    const d = parseDateOnly(v);
    if (d && isValid(d)) return d;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    if (isValid(d)) return d;
  }
  return fallback;
}

function EnhancedCalendar({
  className,
  classNames,
  showOutsideDays = true,
  showClearToday = true,
  onClear,
  onToday,
  month: controlledMonth,
  onMonthChange,
  onSelect: onSelectProp,
  fromYear,
  toYear,
  ...props
}: EnhancedCalendarProps & { onSelect?: any }) {

  const closeParentPopover = React.useCallback(() => {
    setTimeout(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }, 0);
  }, []);

  const handleSelect = React.useCallback((...args: any[]) => {
    (onSelectProp as any)?.(...args);
    const picked = args[0];
    if (picked) closeParentPopover();
  }, [onSelectProp, closeParentPopover]);

  const handleClear = React.useCallback(() => {
    onClear?.();
    closeParentPopover();
  }, [onClear, closeParentPopover]);

  const handleToday = React.useCallback(() => {
    onToday?.();
    closeParentPopover();
  }, [onToday, closeParentPopover]);

  // Sanitize the initial month so a stringy/invalid `selected` never produces
  // a raw epoch number when rendered through date-fns format().
  const today = React.useMemo(() => new Date(), []);
  const initialMonth = React.useMemo(
    () => toSafeDate(controlledMonth ?? (props as any).selected, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [internalMonth, setInternalMonth] = React.useState<Date>(initialMonth);
  const [pickerView, setPickerView] = React.useState<"calendar" | "year" | "month">("calendar");

  const displayMonth = toSafeDate(controlledMonth, internalMonth);

  const handleMonthChange = (newMonth: Date) => {
    const safe = toSafeDate(newMonth, displayMonth);
    setInternalMonth(safe);
    onMonthChange?.(safe);
  };

  const goToPrevMonth = () => handleMonthChange(subMonths(displayMonth, 1));
  const goToNextMonth = () => handleMonthChange(addMonths(displayMonth, 1));

  const currentYear = today.getFullYear();
  const effectiveFromYear = fromYear ?? currentYear - 120;
  const effectiveToYear = toYear ?? currentYear + 10;
  const years = React.useMemo(() => {
    const arr: number[] = [];
    for (let y = effectiveToYear; y >= effectiveFromYear; y--) arr.push(y);
    return arr;
  }, [effectiveFromYear, effectiveToYear]);

  const yearScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (pickerView === "year" && yearScrollRef.current) {
      const activeEl = yearScrollRef.current.querySelector("[data-active='true']");
      if (activeEl) {
        (activeEl as HTMLElement).scrollIntoView({ block: "center" });
      }
    }
  }, [pickerView]);

  const handleYearSelect = (year: number) => {
    handleMonthChange(setYear(displayMonth, year));
    setPickerView("month");
  };

  const handleMonthSelect = (monthIndex: number) => {
    handleMonthChange(setMonth(displayMonth, monthIndex));
    setPickerView("calendar");
  };

  const safeYearLabel = format(displayMonth, "yyyy");
  const safeCaptionLabel = format(displayMonth, "MMMM yyyy");

  // Outer shell — fixed footprint so prev/next never jumps regardless of view.
  return (
    <div
      className="flex flex-col pointer-events-auto"
      style={{ width: 288, height: 348 }}
    >
      {/* Header row — always rendered identically across all 3 sub-views so
          the prev/next stack stays anchored. */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        {pickerView === "calendar" && (
          <button
            type="button"
            onClick={() => setPickerView("year")}
            className="text-sm font-medium hover:text-primary transition-colors cursor-pointer"
          >
            {safeCaptionLabel}
            <span className="ml-1 text-muted-foreground text-xs">▾</span>
          </button>
        )}
        {pickerView === "year" && (
          <span className="text-sm font-medium">Select Year</span>
        )}
        {pickerView === "month" && (
          <button
            type="button"
            onClick={() => setPickerView("year")}
            className="text-sm font-medium hover:text-primary transition-colors cursor-pointer"
          >
            {safeYearLabel}
            <span className="ml-1 text-muted-foreground text-xs">▾</span>
          </button>
        )}

        {pickerView === "calendar" ? (
          <div className="flex flex-col -space-y-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Previous month"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Next month"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerView("calendar")}
            className="text-xs text-primary hover:text-primary/80"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Body — fixed height so swapping sub-views never reflows footer/header. */}
      <div className="px-3" style={{ height: 260 }}>
        {pickerView === "year" && (
          <div
            ref={yearScrollRef}
            className="h-full overflow-y-auto pointer-events-auto overscroll-contain pr-1"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-1 pr-2">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  data-active={y === displayMonth.getFullYear()}
                  onClick={() => handleYearSelect(y)}
                  className={cn(
                    "h-8 rounded text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    y === displayMonth.getFullYear() &&
                      "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        )}

        {pickerView === "month" && (
          <div className="grid grid-cols-3 gap-1 pt-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => handleMonthSelect(i)}
                className={cn(
                  "h-9 rounded text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  i === displayMonth.getMonth() &&
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
              >
                {m.slice(0, 3)}
              </button>
            ))}
          </div>
        )}

        {pickerView === "calendar" && (
          <DayPicker
            {...({ onSelect: handleSelect } as any)}
            showOutsideDays={showOutsideDays}
            month={displayMonth}
            onMonthChange={handleMonthChange}
            weekStartsOn={1}
            className={cn("p-0 pointer-events-auto", className)}
            classNames={{
              months: "flex flex-col",
              month: "space-y-2",
              // Hide the built-in caption — we render our own anchored header above.
              caption: "hidden",
              nav: "hidden",
              table: "w-full border-collapse",
              head_row: "flex",
              head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
              // Reserve 6 week rows so 4/5-row months don't collapse.
              tbody: "min-h-[216px] block",
              row: "flex w-full mt-1",
              cell: "h-8 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
              day: cn(buttonVariants({ variant: "ghost" }), "h-8 w-9 p-0 font-normal aria-selected:opacity-100"),
              day_range_end: "day-range-end",
              day_selected:
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              day_today: "bg-accent text-accent-foreground",
              day_outside:
                "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
              day_disabled: "text-muted-foreground opacity-50",
              day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
              day_hidden: "invisible",
              ...classNames,
            }}
            {...props}
          />
        )}
      </div>

      {showClearToday && (
        <div className="flex items-center justify-between px-4 py-2 mt-auto">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary hover:text-primary/80"
            onClick={handleClear}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary hover:text-primary/80"
            onClick={handleToday}
          >
            Today
          </Button>
        </div>
      )}
    </div>
  );
}
EnhancedCalendar.displayName = "EnhancedCalendar";

export { EnhancedCalendar };
