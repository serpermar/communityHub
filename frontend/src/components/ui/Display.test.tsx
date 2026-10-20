import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Display'
import { SkeletonList } from './Feedback'

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir modal
      </button>
      <Modal
        open={open}
        title="Aviso importante"
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
      >
        <p>Contenido del modal</p>
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('anuncia el diálogo con su título', () => {
    render(
      <Modal open title="Aviso importante" onClose={() => {}}>
        <p>Contenido</p>
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Aviso importante' })).toBeInTheDocument()
  })

  it('mueve el foco dentro del diálogo al abrirse', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Abrir modal' }))

    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
  })

  it('se cierra con Escape y devuelve el foco al disparador', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)

    const trigger = screen.getByRole('button', { name: 'Abrir modal' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('SkeletonList', () => {
  it('pinta tantas filas como se pidan y anuncia que carga', () => {
    render(<SkeletonList rows={4} />)

    const list = screen.getByTestId('skeleton-list')
    expect(list).toHaveAttribute('aria-label', 'Cargando')
    expect(list.children).toHaveLength(4)
  })
})
