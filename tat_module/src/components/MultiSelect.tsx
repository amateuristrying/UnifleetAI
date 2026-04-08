import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export default function MultiSelect({ label, options, selected, onChange, placeholder = "Select..." }: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(item => item !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div className="relative min-w-[200px]" ref={containerRef}>
      <label className="block text-xs font-semibold text-gray-500 mb-1 ml-1">{label}</label>

      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-white border border-gray-300 hover:border-blue-500 rounded-lg py-2 px-3 text-sm text-left shadow-sm transition-all focus:ring-2 focus:ring-blue-100"
      >
        <span className={`truncate ${selected.length === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
          {selected.length === 0
            ? placeholder
            : `${selected.length} selected`}
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">

          {/* Select All / Clear Actions */}
          <div className="flex justify-between p-2 border-b border-gray-100 bg-gray-50 sticky top-0">
            <button
              onClick={() => onChange(options)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded"
            >
              Select All
            </button>
            <button
              onClick={() => onChange([])}
              className="text-xs text-gray-500 hover:text-red-600 font-medium px-2 py-1 rounded"
            >
              Clear
            </button>
          </div>

          {/* Options List */}
          <div className="p-1">
            {options.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <div
                  key={option}
                  onClick={() => toggleOption(option)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded-md text-sm transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                >
                  <div className={`w-4 h-4 border rounded flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                    }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                  {option}
                </div>
              );
            })}
            {options.length === 0 && (
              <div className="p-3 text-center text-gray-400 text-xs">No options found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}