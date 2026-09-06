import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

const Container = styled.div`
  position: relative;
  min-width: 220px;
`

const ChipField = styled.div<{ $disabled?: boolean; $hasError?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 4px 8px;
  border: 1px solid ${({ $hasError }) => ($hasError ? '#f5c2c0' : '#cfd7df')};
  border-radius: 4px;
  background: ${({ $disabled }) => ($disabled ? '#f5f7f9' : '#fff')};
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'text')};

  &:focus-within {
    outline: 2px solid #2c5cc5;
    border-color: #2c5cc5;
  }
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  background: #ebeff3;
  color: #183247;
  font-size: 0.85rem;
  line-height: 1.4;
`

const ChipLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ChipRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #475867;
  font-size: 1rem;
  line-height: 1;
  padding: 0;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: #183247;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const ChipInput = styled.input`
  flex: 1 1 80px;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.95rem;
  padding: 4px 2px;
  color: #183247;

  &:disabled {
    cursor: not-allowed;
  }

  &::placeholder {
    color: #8a9bab;
  }
`

const Dropdown = styled.ul`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #cfd7df;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
`

const DropdownItem = styled.li<{ $highlighted?: boolean }>`
  padding: 8px 12px;
  font-size: 0.92rem;
  cursor: pointer;
  background: ${({ $highlighted }) => ($highlighted ? '#ebf0fb' : 'transparent')};
  color: #183247;

  &:hover {
    background: #ebf0fb;
  }
`

const HelperRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.78rem;
  color: #8a6116;
`

const RetryButton = styled.button`
  border: none;
  background: transparent;
  color: #2c5cc5;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

const EmptyDropdown = styled.li`
  padding: 8px 12px;
  font-size: 0.85rem;
  color: #475867;
`

function normalizeValue(value: string): string {
  return value.trim()
}

function hasValue(values: string[], candidate: string): boolean {
  const normalized = candidate.toLowerCase()
  return values.some((value) => value.toLowerCase() === normalized)
}

export interface ChipSelectProps {
  values: string[]
  onChange: (values: string[]) => void
  options?: string[]
  allowCustom?: boolean
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  inputId?: string
}

export function ChipSelect({
  values,
  onChange,
  options = [],
  allowCustom = false,
  placeholder = 'Type and press Enter',
  disabled = false,
  loading = false,
  error = null,
  onRetry,
  inputId,
}: ChipSelectProps) {
  const generatedId = useId()
  const resolvedInputId = inputId ?? generatedId
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)

  const isDisabled = disabled || loading

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase()
    return options
      .filter((option) => !hasValue(values, option))
      .filter((option) => (query ? option.toLowerCase().includes(query) : true))
      .slice(0, 50)
  }, [inputValue, options, values])

  const showDropdown = !allowCustom && isOpen && !isDisabled && !error

  const addValue = useCallback(
    (raw: string) => {
      const next = normalizeValue(raw)
      if (!next) return

      if (!allowCustom) {
        const match = options.find((option) => option.toLowerCase() === next.toLowerCase())
        if (!match) return
        if (hasValue(values, match)) return
        onChange([...values, match])
        setInputValue('')
        setHighlightIndex(0)
        return
      }

      if (hasValue(values, next)) {
        setInputValue('')
        return
      }

      onChange([...values, next])
      setInputValue('')
      setHighlightIndex(0)
    },
    [allowCustom, onChange, options, values],
  )

  const removeValue = useCallback(
    (index: number) => {
      onChange(values.filter((_, valueIndex) => valueIndex !== index))
    },
    [onChange, values],
  )

  const commitInput = useCallback(() => {
    if (!inputValue.trim()) return
    addValue(inputValue)
  }, [addValue, inputValue])

  useEffect(() => {
    if (highlightIndex >= filteredOptions.length) {
      setHighlightIndex(Math.max(filteredOptions.length - 1, 0))
    }
  }, [filteredOptions.length, highlightIndex])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isDisabled) return

    if (event.key === 'Enter') {
      event.preventDefault()
      if (!allowCustom && filteredOptions.length > 0) {
        addValue(filteredOptions[highlightIndex] ?? filteredOptions[0])
        return
      }
      commitInput()
      return
    }

    if (event.key === ',') {
      if (allowCustom) {
        event.preventDefault()
        commitInput()
      }
      return
    }

    if (event.key === 'Backspace' && !inputValue && values.length > 0) {
      removeValue(values.length - 1)
      return
    }

    if (!allowCustom && showDropdown) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightIndex((index) => Math.min(index + 1, filteredOptions.length - 1))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightIndex((index) => Math.max(index - 1, 0))
        return
      }

      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
  }

  const resolvedPlaceholder =
    loading ? 'Loading…' : error ? 'Unavailable' : values.length === 0 ? placeholder : ''

  return (
    <Container ref={containerRef}>
      <ChipField
        $disabled={isDisabled}
        $hasError={Boolean(error)}
        onClick={() => {
          if (!isDisabled) inputRef.current?.focus()
        }}
      >
        {values.map((value, index) => (
          <Chip key={`${value}-${index}`}>
            <ChipLabel title={value}>{value}</ChipLabel>
            <ChipRemove
              type="button"
              aria-label={`Remove ${value}`}
              disabled={isDisabled}
              onClick={(event) => {
                event.stopPropagation()
                removeValue(index)
              }}
            >
              ×
            </ChipRemove>
          </Chip>
        ))}
        <ChipInput
          ref={inputRef}
          id={resolvedInputId}
          type="text"
          value={inputValue}
          placeholder={resolvedPlaceholder}
          disabled={isDisabled || Boolean(error)}
          onChange={(event) => {
            setInputValue(event.target.value)
            if (!allowCustom) setIsOpen(true)
          }}
          onFocus={() => {
            if (!allowCustom && !error) setIsOpen(true)
          }}
          onBlur={() => {
            if (allowCustom) commitInput()
          }}
          onKeyDown={handleInputKeyDown}
        />
      </ChipField>

      {showDropdown ? (
        <Dropdown role="listbox">
          {filteredOptions.length === 0 ? (
            <EmptyDropdown>No matching tags</EmptyDropdown>
          ) : (
            filteredOptions.map((option, index) => (
              <DropdownItem
                key={option}
                role="option"
                aria-selected={index === highlightIndex}
                $highlighted={index === highlightIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => addValue(option)}
              >
                {option}
              </DropdownItem>
            ))
          )}
        </Dropdown>
      ) : null}

      {error ? (
        <HelperRow>
          <span>{error}</span>
          {onRetry ? (
            <RetryButton type="button" onClick={onRetry}>
              Retry
            </RetryButton>
          ) : null}
        </HelperRow>
      ) : null}
    </Container>
  )
}
