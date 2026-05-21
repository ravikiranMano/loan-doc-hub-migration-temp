import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format, addMonths, subMonths, setMonth, setYear } from "date-fns";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";


export type EnhancedCalendarProps = React.ComponentProps<typeof DayPicker> & {
  onClear?: () => void;
  onToday?: () => void;
  showClearToday?: boolean;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function EnhancedCalendar({
  className,
  classNames,
  showOutsideDays = true,
  showClearToday = true,
  onClear,
  onToday,
  month: controlledMonth,
  onMonthChange,
  ...props
}: EnhancedCalendarProps) {
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    controlledMonth || (props.selected instanceof Date ? props.selected : new Date())
  );
  const [pickerView, setPickerView] = React.useState<"calendar" | "year" | "month">("calendar");

  const displayMonth = controlledMonth || internalMonth;

  const handleMonthChange = (newMonth: Date) => {
    setInternalMonth(newMonth);
    onMonthChange?.(newMonth);
  };

  const goToPrevMonth = () => handleMonthChange(subMonths(displayMonth, 1));
  const goToNextMonth = () => handleMonthChange(addMonths(displayMonth, 1));

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 100;
  const maxYear = currentYear + 100;
  const years = React.useMemo(() => {
    const arr: number[] = [];
    for (let y = maxYear; y >= minYear; y--) arr.push(y);
    return arr;
  }, []);

  const yearScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (pickerView === "year" && yearScrollRef.current) {
      const activeEl = yearScrollRef.current.querySelector("[data-active='true']");
      if (activeEl) {
        activeEl.scrollIntoView({ block: "center" });
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

  if (pickerView === "year") {
    return (
      <div className="flex flex-col p-3 pointer-events-auto" style={{ width: 288 }}>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-sm font-medium">Select Year</span>
          <button type="button" onClick={() => setPickerView("calendar")} className="text-xs text-primary hover:text-primary/80">
            Cancel
          </button>
        </div>
        <div
          ref={yearScrollRef}
          className="h-[260px] overflow-y-auto pointer-events-auto overscroll-contain pr-1"
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
                  y === displayMonth.getFullYear() && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (pickerView === "month") {
    return (
      <div className="flex flex-col p-3 pointer-events-auto" style={{ width: 288 }}>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-sm font-medium">{displayMonth.getFullYear()}</span>
          <button type="button" onClick={() => setPickerView("year")} className="text-xs text-primary hover:text-primary/80">
            Change Year
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => handleMonthSelect(i)}
              className={cn(
                "h-9 rounded text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                i === displayMonth.getMonth() && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
              )}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <DayPicker
        showOutsideDays={showOutsideDays}
        month={displayMonth}
        onMonthChange={handleMonthChange}
        weekStartsOn={1}
        className={cn("p-3 pointer-events-auto", className)}
        classNames={{
          months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          caption: "flex justify-center pt-1 relative items-center",
          caption_label: "text-sm font-medium",
          nav: "space-x-1 flex items-center",
          nav_button: cn(
            buttonVariants({ variant: "outline" }),
            "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
          ),
          nav_button_previous: "absolute left-1",
          nav_button_next: "absolute right-1",
          table: "w-full border-collapse space-y-1",
          head_row: "flex",
          head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
          day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
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
        components={{
          Caption: ({ displayMonth: dm }) => (
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setPickerView("year")}
                className="text-sm font-medium hover:text-primary transition-colors cursor-pointer"
              >
                {format(dm, "MMMM, yyyy")}
                <span className="ml-1 text-muted-foreground text-xs">▾</span>
              </button>
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
            </div>
          ),
        }}
        {...props}
      />
      {showClearToday && (
        <div className="flex items-center justify-between px-4 pb-3 -mt-1">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary hover:text-primary/80"
            onClick={onClear}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary hover:text-primary/80"
            onClick={onToday}
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
