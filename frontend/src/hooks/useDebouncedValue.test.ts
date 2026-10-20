import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  it('devuelve el valor inicial de inmediato', () => {
    const { result } = renderHook(() => useDebouncedValue('inicial', 250))

    expect(result.current).toBe('inicial')
  })

  it('no actualiza el valor hasta que pasa el retraso', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 20), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    expect(result.current).toBe('a')

    await waitFor(() => expect(result.current).toBe('ab'))
  })
})
