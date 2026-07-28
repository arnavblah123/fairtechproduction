"use client";

import { useEffect, useRef, useState } from "react";

export type SearchOption = { value: string; label: string; group?: string };

// Drop-down with a built-in search box: type to filter, tap to pick. Posts
// the picked value through a hidden input, so it drops into any server-action
// form exactly like a native <select>.
export function SearchSelect({
  name,
  options,
  placeholder = "Type to search…",
  required = false,
  defaultValue = "",
  onValueChange,
  className = "",
  small = false,
}: {
  name: string;
  options: SearchOption[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue);
  const wrap = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, []);

  let lastGroup: string | undefined;

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <input
        type="text"
        value={open ? query : selected?.label ?? ""}
        placeholder={selected ? selected.label : placeholder}
        required={required && !value}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className={`w-full rounded-lg border border-slate-300 ${
          small ? "px-2 py-1.5 text-xs" : "px-2 py-1.5 text-sm"
        }`}
        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
      />
      {open && (
        <div
          className="absolute z-30 mt-1 left-0 right-0 min-w-48 max-h-56 overflow-y-auto rounded-lg border border-slate-200 shadow-lg"
          style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
        >
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No match.</p>
          )}
          {filtered.slice(0, 200).map((o) => {
            const header = o.group && o.group !== lastGroup ? o.group : undefined;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {header && (
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setValue(o.value);
                    onValueChange?.(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`block w-full text-left px-3 py-2 text-sm hover:bg-blue-50 active:bg-blue-100 ${
                    o.value === value ? "bg-blue-50 font-medium" : ""
                  }`}
                  style={{ color: "#0f172a" }}
                >
                  {o.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
