import { useEffect, useRef, useState } from "react";
import styles from "./multi-select-input.module.css";

type MultiSelectInputProps = {
  value: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function MultiSelectInput({
  value,
  suggestions,
  onChange,
  disabled = false,
  placeholder = "Type to search...",
}: MultiSelectInputProps) {
  const [inputText, setInputText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = suggestions.filter(
    (s) =>
      !value.includes(s) &&
      s.toLowerCase().includes(inputText.toLowerCase()),
  );

  const addItem = (item: string) => {
    if (!value.includes(item)) {
      onChange([...value, item]);
    }
    setInputText("");
    setFocusedIndex(-1);
    inputRef.current?.focus();
  };

  const removeItem = (item: string) => {
    onChange(value.filter((v) => v !== item));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && inputText === "" && value.length > 0) {
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      setFocusedIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setFocusedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && filtered[focusedIndex]) {
        addItem(filtered[focusedIndex]);
      } else if (inputText.trim() && filtered.length > 0) {
        addItem(filtered[0]);
      }
      return;
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper}${disabled ? ` ${styles.wrapperDisabled}` : ""}`}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {value.map((item) => (
        <span key={item} className={styles.chip}>
          {item}
          <button
            type="button"
            className={styles.chipRemove}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) removeItem(item);
            }}
            aria-label={`Remove ${item}`}
          >
            ×
          </button>
        </span>
      ))}

      <input
        ref={inputRef}
        className={styles.input}
        value={inputText}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        onChange={(e) => {
          setInputText(e.target.value);
          setIsOpen(true);
          setFocusedIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {isOpen && filtered.length > 0 && (
        <div className={styles.dropdown}>
          {filtered.map((item, idx) => (
            <div
              key={item}
              className={`${styles.option}${idx === focusedIndex ? ` ${styles.optionFocused}` : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                addItem(item);
              }}
              onMouseEnter={() => setFocusedIndex(idx)}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
